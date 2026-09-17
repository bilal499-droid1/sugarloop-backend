/**
 * Turning a priced cart into an order.
 *
 * The whole file turns on one rule: **the quote is not trusted either.** `POST /orders`
 * re-runs the pricing engine from scratch against the database as it is right now, and if
 * the total has moved since the customer was quoted — a price changed, an item sold out,
 * the branch shut — the order is REJECTED rather than silently repriced. Charging someone
 * a number they never agreed to is worse than making them look again.
 */
import { Order } from '../models/Order.js'
import { Counter } from '../models/Counter.js'
import { ApiError } from '../utils/ApiError.js'
import { businessDateStamp } from '../utils/time.js'
import { FULFILMENT, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../config/constants.js'
import { quote as priceQuote } from './checkout.service.js'
import { notifyOrderPlaced } from './notification.service.js'
import { scheduleOrderEscalation } from '../queues/orderEscalation.js'
import { sendPurchase } from './metaConversions.service.js'

const ORDER_PREFIX = 'SL'
const SEQUENCE_PAD = 4

/**
 * `SL-260810-0042`, allocated atomically.
 *
 * Called only AFTER pricing has succeeded. Allocating earlier would burn a number on every
 * rejected cart, and gaps in a sequential order book are the kind of thing that makes an
 * accountant ask which orders went missing.
 *
 * The sequence is date-scoped in Asia/Karachi, so it restarts each day and a server on UTC
 * cannot roll it over five hours early.
 */
export async function nextOrderNumber(now = new Date()) {
  const stamp = businessDateStamp(now)
  const seq = await Counter.next(`order:${stamp}`)

  // Four digits carries 9,999 orders in a day. If that is ever exceeded the number simply
  // grows a digit rather than wrapping and colliding with an existing order.
  return `${ORDER_PREFIX}-${stamp}-${String(seq).padStart(SEQUENCE_PAD, '0')}`
}

/**
 * Did anything move between the quote the customer saw and now?
 *
 * Compared on the grand total rather than line by line, because that is the number the
 * customer agreed to pay. A cart that reshuffled its lines but costs the same is not a
 * change worth interrupting a checkout for; a cart that costs more is.
 */
function assertQuoteStillHolds(priced, expectedTotal) {
  if (priced.totals.grandTotal === expectedTotal) return

  throw new ApiError(
    409,
    'PRICE_CHANGED',
    'Prices changed while you were checking out. Please review your order.',
    {
      quotedTotal: expectedTotal,
      currentTotal: priced.totals.grandTotal,
      difference: priced.totals.grandTotal - expectedTotal,
    }
  )
}

/** The priced line, flattened onto the order and snapshotted. */
function toOrderItem(line) {
  return {
    kind: line.kind,
    productId: line.productId ?? null,
    sku: line.sku ?? null,
    name: line.name,
    unitPrice: line.unitPrice,
    qty: line.qty,
    lineTotal: line.lineTotal,
    boxSize: line.boxSize ?? null,
    children: line.children,
    netAmount: line.netAmount,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    grossAmount: line.grossAmount,
  }
}

/**
 * The order must be placed under the address that was actually verified.
 *
 * Without this the whole OTP flow is decorative: anyone could verify their own address
 * once and then place unlimited orders naming somebody else's contact details.
 *
 * Note what this no longer buys. While verification was on the phone number, this check
 * was the thing that made a prank Cash-on-Delivery order cost a real SIM — the callback
 * number is the only handle the branch has on a COD customer. Verifying the email
 * instead means the number on the order is once again unproven, and a prankster needs
 * only a throwaway inbox. Kept because binding the order to *some* verified identity is
 * still worth having; see services/otpDelivery.service.js for the trade.
 *
 * Both sides are lowercased and trimmed by the same rule (see the two validators), so
 * this compares like with like.
 */
function assertEmailWasVerified(request, verifiedEmail) {
  if (!verifiedEmail) {
    // Reaching here means the route lost its `requireCustomer` guard. That is a
    // programming error, and failing loudly beats silently accepting unverified orders.
    throw ApiError.internal('order.create called without a verified email')
  }

  if (request.contact.email !== verifiedEmail) {
    throw new ApiError(
      403,
      'EMAIL_MISMATCH',
      'This order must use the email address you verified',
      { verifiedEmail }
    )
  }
}

/**
 * Places an order.
 *
 * @param request  validated body — cart, fulfilment, contact, address, expectedTotal
 * @param context  { ip, userAgent, verifiedEmail, tracking }. `verifiedEmail` comes from
 *                 the OTP session token, never from the body. ip/userAgent are the fraud
 *                 trail and are never returned to a client. `tracking` holds the Meta
 *                 cookies and page URL, used for the ad conversion and never stored.
 */
export async function create(
  request,
  context = {},
  { now = new Date(), notifications = undefined } = {}
) {
  assertEmailWasVerified(request, context.verifiedEmail)

  // Re-price from scratch. This re-runs every gate the quote ran — stock, opening hours,
  // the minimum, the delivery radius — against the database as it is at this instant.
  const priced = await priceQuote(request, { now })

  assertQuoteStillHolds(priced, request.expectedTotal)

  const { branch } = priced
  const orderNumber = await nextOrderNumber(now)

  const isDelivery = priced.fulfilment === FULFILMENT.DELIVERY

  /**
   * Where the pricing engine decided this order is going. `$resolvedPoint` is attached by
   * `resolveBranch` and is authoritative: it is the same point the branch and the 2 km
   * radius check were computed from, so storing anything else could put a rider outside
   * the area the order was accepted for. Falls back to the request for the coordinates
   * path, where the two are identical anyway.
   */
  const deliveryPoint = isDelivery ? (branch.$resolvedPoint ?? request.location) : null

  const order = await Order.create({
    orderNumber,
    customerId: null, // set once customer accounts exist (Sprint 2)

    contact: request.contact,

    branchId: branch._id,
    branchCode: branch.code,
    fulfilment: priced.fulfilment,

    address: isDelivery
      ? {
          line1: request.address.line1,
          area: request.address.area,
          city: request.address.city,
          /**
           * The point the branch was actually chosen from — which for an address-only
           * checkout was geocoded server-side and was never in the request at all.
           * Snapshotted rather than re-derived: this is where the rider goes, and it must
           * not move if the customer edits a saved address, or if a geocoder returns a
           * different answer next month.
           */
          location: { type: 'Point', coordinates: [deliveryPoint.lng, deliveryPoint.lat] },
          notes: request.address.notes,
        }
      : null,

    distanceKm: isDelivery ? (branch.distanceKm ?? null) : null,

    items: priced.items.map(toOrderItem),
    totals: priced.totals,

    payment: {
      method: PAYMENT_METHOD.COD,
      status: PAYMENT_STATUS.PENDING,
      provider: null,
    },

    status: ORDER_STATUS.PLACED,
    statusHistory: [{ status: ORDER_STATUS.PLACED, at: now, by: 'system' }],

    promisedAt: priced.promisedAt,

    meta: {
      ip: context.ip ?? '',
      userAgent: context.userAgent ?? '',
      source: 'web',
    },
  })

  // The branch is already loaded; attaching it saves the caller a second query when the
  // view needs the branch name and phone for the confirmation screen.
  order.$branch = branch

  // Told, not asked: the order exists and the customer has been charged nothing yet, so a
  // notification that fails changes nothing about whether this call succeeded. `notify`
  // swallows its own errors for that reason — see notification.service.js.
  await notifyOrderPlaced(order, branch, notifications)

  // Starts the chase clock. Also told, not asked, and for the same reason as the
  // notification above: the order is already placed, so a queue that is down must not
  // turn a successful checkout into a 500.
  await scheduleOrderEscalation(order)

  // Deliberately not awaited: Meta's latency is no reason to hold a customer's
  // confirmation screen. `sendPurchase` never rejects.
  void sendPurchase(
    order,
    { ip: context.ip, userAgent: context.userAgent, ...context.tracking },
    { now }
  )

  return order
}

/**
 * One order, looked up by its number.
 *
 * ⚠️ Guarded by the contact email, deliberately. Order numbers are sequential and
 * therefore trivially enumerable — `SL-260810-0041`, `0042`, `0043` — so an unguarded
 * lookup would hand anyone every customer's name and address by counting.
 *
 * The guard was the contact phone until checkout stopped collecting one. An order placed
 * since then has no number to match, so keeping it would have made every new order
 * impossible to look up. Email is the field every order now carries, and the one the
 * customer proved they hold.
 *
 * A mismatch returns 404 rather than 403: confirming that an order exists but belongs to
 * someone else is the same leak in a politer tone. The `!order.contact.email` arm covers
 * orders written before the changeover — they have no address stored, and `undefined`
 * must never satisfy a missing query parameter.
 *
 * This is an interim measure. A real customer login replaces it, and this argument goes
 * away.
 */
export async function getByNumber(orderNumber, { email } = {}) {
  const order = await Order.findOne({ orderNumber: String(orderNumber).toUpperCase() }).populate(
    'branchId',
    'code name address phone'
  )

  if (!order || !order.contact.email || order.contact.email !== email) {
    throw ApiError.notFound('Order not found')
  }

  return order
}
