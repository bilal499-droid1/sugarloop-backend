/**
 * The last rung of the unacknowledged-order ladder: fail it, and say so.
 *
 * `queues/orderEscalation.js` chases the branch at five minutes and the admin at ten,
 * and then the ladder stops. An order nobody acted on used to sit in `placed` forever:
 * the board kept offering "Mark confirmed", the customer was told nothing, and the
 * system's last word on a forgotten order was a message to someone who had already
 * ignored one. This is the step that ends it.
 *
 * **The cancellation is not the point — the message is.** A customer who hears "nobody
 * picked this up, you owe nothing, call us and we will make it now" has been treated
 * well. One who waits two hours in silence is gone for good and tells people. Failing
 * the order is what makes that message true.
 *
 * Nothing needs unwinding: payment is COD, so there is nothing to refund, and stock is
 * an in/out flag with no reservation, so there is nothing to release.
 *
 * **A sweep, not a queued job, and that is deliberate.** The escalation ladder rides on
 * BullMQ, which only exists when `REDIS_URL` is set — so on a box without Redis that
 * whole safety net silently does not exist, which is the failure this was written to
 * fix. A query every minute needs no Redis, survives a restart, and picks up orders
 * placed before this shipped.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { FAILURE_REASON, ORDER_STATUS } from '../config/constants.js'
import { Order } from '../models/Order.js'
import { closingAt } from '../utils/time.js'
import { formatPKR } from '../utils/money.js'
import * as audit from './audit.service.js'
import { sendEmail } from './email.service.js'
import { notifyOrderExpired } from './notification.service.js'
import { cancelOrderEscalation } from '../queues/orderEscalation.js'

const BRANCH_FIELDS = 'name phone hours address'

/**
 * Nobody is behind this transition, and the schema already says so: `statusHistory.by`
 * is "a StaffUser id, or the string 'system' for a timed transition".
 */
const SYSTEM = 'system'

/**
 * How many orders one pass will look at. A shop with more than this waiting has a bigger
 * problem than this sweep, and the next pass is sixty seconds away.
 */
const MAX_PER_SWEEP = 200

/**
 * When this order stops being worth waiting for: the fuse, or closing time, whichever
 * comes first.
 *
 * Closing time is in here because a 30-minute fuse lit at 02:55 against an 03:00 close
 * burns down at 03:25, in a dark shop, where nobody could have confirmed it — and the
 * customer finds out in the morning. A branch that cannot act on an order after 03:00
 * should not still be holding one at 03:01.
 *
 * Pure, and exported for the tests: every interesting case here is a clock, and a clock
 * is worth proving without a database.
 */
export function expiryDeadline({ placedAt, branch, minutes = env.ORDER_AUTO_CANCEL_MINUTES }) {
  const fuse = new Date(placedAt.getTime() + minutes * 60_000)

  const close = branch?.hours?.open
    ? closingAt({ open: branch.hours.open, close: branch.hours.close, at: placedAt })
    : null

  if (!close) return fuse

  return close.getTime() < fuse.getTime() ? close : fuse
}

/**
 * Fail one order, if it is still waiting.
 *
 * The write is conditional on `placed` for the same reason `staffOrder.changeStatus` is
 * conditional on the status it validated: a manager clicking Confirm at 29:58 and a
 * sweep firing at 30:00 are one race, settled by whichever update matches first. The
 * loser writes nothing. No lock, and no order cancelled after somebody accepted it.
 *
 * Returns the failed order, or `null` when it had already moved — which is not an error
 * and not worth logging. It is the system working.
 */
export async function expireOrder(
  order,
  { now = new Date(), notifications, email = sendEmail } = {}
) {
  const waitedMinutes = Math.round((now.getTime() - order.createdAt.getTime()) / 60_000)

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: ORDER_STATUS.PLACED },
    {
      $set: {
        status: ORDER_STATUS.FAILED,
        failureReason: FAILURE_REASON.NOT_ACKNOWLEDGED,
      },
      $push: {
        statusHistory: {
          status: ORDER_STATUS.FAILED,
          at: now,
          by: SYSTEM,
          reason: FAILURE_REASON.NOT_ACKNOWLEDGED,
          note: `No one confirmed this order within ${waitedMinutes} minutes.`,
        },
      },
    },
    { new: true, runValidators: true }
  ).populate('branchId', BRANCH_FIELDS)

  if (!updated) return null

  const branch = updated.branchId

  logger.warn(
    {
      orderNumber: updated.orderNumber,
      branch: branch?.name,
      waitedMinutes,
      total: formatPKR(updated.totals.grandTotal),
    },
    'ORDER EXPIRED: nobody acknowledged this order, so it was failed automatically'
  )

  await audit.record({
    actor: { email: SYSTEM, role: SYSTEM },
    action: 'order.status.expire',
    entity: 'Order',
    entityId: updated._id,
    changes: {
      orderNumber: updated.orderNumber,
      status: { from: ORDER_STATUS.PLACED, to: ORDER_STATUS.FAILED },
      reason: FAILURE_REASON.NOT_ACKNOWLEDGED,
      waitedMinutes,
    },
  })

  // Best-effort, exactly as on the staff path: the chases re-read the order before they
  // send, so one that loses this race only wakes up and decides to do nothing.
  await cancelOrderEscalation(updated._id)

  await tellCustomer(updated, branch, email)
  await notifyOrderExpired({ order: updated, branch }, notifications)

  return updated
}

/**
 * The apology, by email, because email is what this shop can actually reach a customer
 * on today — checkout verifies an address and `contact.phone` is null on new orders.
 *
 * Never throws. A mail server having a bad minute must not leave the order looking
 * unprocessed to the next pass; the cancellation already happened, and failing to
 * announce it is a logged problem rather than a reason to redo any of it.
 */
async function tellCustomer(order, branch, send) {
  if (!order.contact?.email) return

  const greeting = order.contact.name ? `${order.contact.name}, ` : ''
  const phone = branch?.phone ?? ''

  try {
    await send({
      to: order.contact.email,
      subject: `We are sorry — order ${order.orderNumber} was not started`,
      text:
        `${greeting}we owe you an apology.\n\n` +
        `Your order ${order.orderNumber} reached ${branch?.name ?? 'our shop'}, but ` +
        `nobody there confirmed it. We have cancelled it rather than leave you waiting ` +
        `for donuts that were never started.\n\n` +
        `You have not been charged. Our orders are cash on delivery, so there is ` +
        `nothing to refund.\n\n` +
        `If you still want it, call us on ${phone} and we will make it now — or order ` +
        `again on the site.\n\n` +
        `Sorry again,\nSugar Loop`,
      replyTo: env.ENQUIRY_NOTIFY_EMAIL,
    })
  } catch (err) {
    logger.error(
      { err, orderNumber: order.orderNumber },
      'Order expired but the apology email did not send'
    )
  }
}

/**
 * One pass: every order still in `placed` past its deadline.
 *
 * Every `placed` order is read rather than filtered by `createdAt` in the query, because
 * the deadline is per-branch — closing time can bring it forward — and a filter written
 * against the fuse alone would skip exactly the orders that should expire earliest.
 * `placed` is the unacknowledged pile, which on a working shop is a handful of rows.
 *
 * One order failing does not stop the pass. Whatever went wrong with that row is worth a
 * log line, not a queue of customers left waiting behind it.
 */
export async function expireStaleOrders({ now = new Date(), notifications, email } = {}) {
  const minutes = env.ORDER_AUTO_CANCEL_MINUTES
  if (minutes === 0) return { scanned: 0, expired: 0 }

  const waiting = await Order.find({ status: ORDER_STATUS.PLACED })
    .sort({ createdAt: 1 })
    .limit(MAX_PER_SWEEP)
    .populate('branchId', BRANCH_FIELDS)

  let expired = 0

  for (const order of waiting) {
    const deadline = expiryDeadline({
      placedAt: order.createdAt,
      branch: order.branchId,
      minutes,
    })

    if (now.getTime() < deadline.getTime()) continue

    try {
      if (await expireOrder(order, { now, notifications, email })) expired += 1
    } catch (err) {
      logger.error(
        { err, orderNumber: order.orderNumber },
        'Failed to expire an unacknowledged order'
      )
    }
  }

  return { scanned: waiting.length, expired }
}
