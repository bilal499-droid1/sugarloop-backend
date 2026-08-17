/**
 * The staff order board: reading orders, and moving them through the state machine.
 *
 * Two rules govern this file:
 *
 * 1. **Branch scope comes from the token, never from the query.** A `branch_manager`
 *    reads and moves orders at their own branch and nowhere else, whatever `branchId`
 *    the client sends. That check lives here rather than in a controller because every
 *    entry point into these orders has to pass through it.
 * 2. **A transition is a conditional write.** Two managers on a polling dashboard will
 *    click the same button within the same second; the update only applies if the order
 *    is still in the state that was validated. See `changeStatus`.
 */
import { Order } from '../models/Order.js'
import { ApiError } from '../utils/ApiError.js'
import { assertBranchAccess } from '../middleware/auth.js'
import { businessDayRange } from '../utils/time.js'
import { allowedTransitions, assertTransition } from './orderStatus.js'
import * as audit from './audit.service.js'
import {
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  STAFF_ROLE,
  TERMINAL_ORDER_STATUSES,
} from '../config/constants.js'

/** The branch fields every order view needs, so a board render is one query, not N. */
const BRANCH_FIELDS = 'code name address phone'

/**
 * Which branch's orders this request may touch.
 *
 * An admin sees everything and may narrow to one branch. A branch manager is pinned to
 * their own: asking for someone else's is a 403 rather than a silent re-scope, because
 * quietly returning different data than was asked for teaches a frontend that the filter
 * works when it does not.
 */
function scopeBranch(actor, requestedBranchId) {
  if (actor.role === STAFF_ROLE.ADMIN) return requestedBranchId ?? null

  if (requestedBranchId) assertBranchAccess(actor, requestedBranchId)

  const own = actor.branchId?._id ?? actor.branchId
  if (!own) {
    // A branch manager with no branch cannot be scoped to anything, and defaulting to
    // "all branches" would be exactly backwards. The StaffUser model and the staff-user
    // service both refuse to create this, so it is a data repair, not a login problem.
    throw ApiError.internal('This account has no branch assigned')
  }

  return own
}

/**
 * The order board.
 *
 * `date` is a local calendar date in Asia/Karachi — the day the kitchen means when it
 * says "today", not the one a server on UTC would compute five hours early.
 */
export async function list({ status, branchId, date, fulfilment, phone, limit, cursor }, actor) {
  const filter = {}

  const scopedBranch = scopeBranch(actor, branchId)
  if (scopedBranch) filter.branchId = scopedBranch

  if (status) filter.status = status
  if (fulfilment) filter.fulfilment = fulfilment

  // The board's search box. Exact match on the stored E.164 form — the validator
  // normalises whatever the operator typed, so `0300 1234567` finds `+923001234567`.
  if (phone) filter['contact.phone'] = phone

  if (date) {
    const { start, end } = businessDayRange(date)
    filter.createdAt = { $gte: start, $lt: end }
  }

  // Cursor pagination on _id, matching staffUser.service.list. Sorting by createdAt
  // would read better on a board, but two orders placed in the same millisecond need a
  // unique tiebreaker or the cursor skips one — and _id already carries the timestamp.
  if (cursor) filter._id = { $lt: cursor }

  const rows = await Order.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('branchId', BRANCH_FIELDS)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
  }
}

/**
 * One order by its database id, scoped to what this staff member may see.
 *
 * 404 rather than 403 for another branch's order: the staff board has no reason to
 * confirm that an id it may not read exists at all.
 */
export async function getById(id, actor) {
  const order = await Order.findById(id).populate('branchId', BRANCH_FIELDS)
  if (!order) throw ApiError.notFound('Order not found')

  if (actor.role !== STAFF_ROLE.ADMIN) {
    const own = actor.branchId?._id ?? actor.branchId
    if (String(own) !== String(order.branchId?._id ?? order.branchId)) {
      throw ApiError.notFound('Order not found')
    }
  }

  return order
}

/**
 * Cash on Delivery means the money arrives with the donuts, so completion IS collection.
 *
 * Set here rather than left to a separate "mark paid" click nobody would ever make: an
 * order book where every completed order still reads `payment.status: pending` cannot
 * produce a day's takings, which is the first report the client will ask for.
 */
function paymentUpdateFor(order, next) {
  if (next !== ORDER_STATUS.COMPLETED) return {}
  if (order.payment?.method !== PAYMENT_METHOD.COD) return {}

  return { 'payment.status': PAYMENT_STATUS.COLLECTED }
}

/**
 * Moves an order to `next`, appending to `statusHistory`.
 *
 * The write is conditional on the order still being in the state that was validated
 * (`status: order.status` in the filter). Without that, two managers reading the same
 * board a second apart can both validate `preparing → out_for_delivery`, and the second
 * write lands a duplicate transition on an order that has already moved on. The loser
 * gets a 409 and a refreshed board, which is the truthful answer.
 *
 * @param context  `{ actor, ip }` — actor is the StaffUser, or the string 'system' once
 *                 Sprint 2's timers call this.
 */
export async function changeStatus(id, { status: next, reason = null, note = null }, context) {
  const order = await getById(id, context.actor)

  assertBranchAccess(context.actor, order.branchId)
  assertTransition(order, next, { reason, note })

  const at = new Date()

  const event = {
    status: next,
    at,
    by: context.actor._id,
    note: note ?? undefined,
    reason: reason ?? null,
  }

  const update = {
    $set: {
      status: next,
      ...paymentUpdateFor(order, next),
      // Terminal and reportable, so it is denormalised onto the order rather than left
      // to be dug out of the history every time a report counts failures by reason.
      ...(next === ORDER_STATUS.FAILED ? { failureReason: reason } : {}),
    },
    $push: { statusHistory: event },
  }

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status },
    update,
    { new: true, runValidators: true }
  ).populate('branchId', BRANCH_FIELDS)

  if (!updated) {
    throw ApiError.conflict(
      'This order was moved by someone else while you were working on it. Refresh and try again.',
      { from: order.status, to: next }
    )
  }

  await audit.record({
    actor: context.actor,
    action: 'order.status.change',
    entity: 'Order',
    entityId: updated._id,
    // The order NUMBER is what a human searching this trail actually has in hand; the
    // entityId is what a query joins on. Both, because they answer different questions.
    changes: {
      orderNumber: updated.orderNumber,
      status: { from: order.status, to: next },
      ...(reason ? { reason } : {}),
      ...(note ? { note } : {}),
    },
    ip: context.ip,
  })

  return updated
}

/** What the board may do with this order next. Exposed on the single-order view. */
export function transitionsFor(order) {
  return {
    allowed: allowedTransitions(order),
    isTerminal: TERMINAL_ORDER_STATUSES.includes(order.status),
  }
}
