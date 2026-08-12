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
 * Places an order.
 *
 * @param request  validated body — cart, fulfilment, contact, address, expectedTotal
 * @param context  { ip, userAgent } for the fraud trail. Never returned to a client.
 */
export async function create(request, context = {}, { now = new Date() } = {}) {
  // Re-price from scratch. This re-runs every gate the quote ran — stock, opening hours,
  // the minimum, the delivery radius — against the database as it is at this instant.
  const priced = await priceQuote(request, { now })

  assertQuoteStillHolds(priced, request.expectedTotal)

  const { branch } = priced
  const orderNumber = await nextOrderNumber(now)

  const isDelivery = priced.fulfilment === FULFILMENT.DELIVERY

  const order = await Order.create({
    orderNumber,
    customerId: null, // set once phone-OTP exists (Sprint 2)

    contact: request.contact,

    branchId: branch._id,
    branchCode: branch.code,
    fulfilment: priced.fulfilment,

    address: isDelivery
      ? {
          line1: request.address.line1,
          area: request.address.area,
          city: request.address.city,
          // Snapshotted from the request, not re-derived — this is where the rider goes,
          // and it must not change if the customer edits a saved address later.
          location: { type: 'Point', coordinates: [request.location.lng, request.location.lat] },
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

  return order
}

/**
 * One order, looked up by its number.
 *
 * ⚠️ Guarded by the contact phone, deliberately. Order numbers are sequential and
 * therefore trivially enumerable — `SL-260810-0041`, `0042`, `0043` — so an unguarded
 * lookup would hand anyone every customer's name, address and phone by counting.
 *
 * A mismatch returns 404 rather than 403: confirming that an order exists but belongs to
 * someone else is the same leak in a politer tone.
 *
 * This is an interim measure. Sprint 2's phone-OTP session replaces it with a real
 * identity check, and this argument goes away.
 */
export async function getByNumber(orderNumber, { phone } = {}) {
  const order = await Order.findOne({ orderNumber: String(orderNumber).toUpperCase() }).populate(
    'branchId',
    'code name address phone'
  )

  if (!order || order.contact.phone !== phone) {
    throw ApiError.notFound('Order not found')
  }

  return order
}
