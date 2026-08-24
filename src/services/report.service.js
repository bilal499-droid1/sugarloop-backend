/**
 * The daily report — what a shop actually made in a day.
 *
 * **Takings count `completed` orders and nothing else.** On Cash on Delivery, completion
 * *is* collection (`staffOrder.service` sets `payment.status` to `collected` on the same
 * transition), so a day's takings is the sum of what was handed over. An order still
 * `out_for_delivery` at midnight is money that may yet be refused at the door, and one
 * that `failed` is money that never existed — counting either would produce a number the
 * till cannot reconcile against.
 *
 * The day is a calendar date in `Asia/Karachi`, not a UTC window: the shop trades until
 * 03:00, so "today" on a UTC server ends five hours early and cuts the busiest part of a
 * night in half.
 */
import mongoose from 'mongoose'
import { Order } from '../models/Order.js'
import { ApiError } from '../utils/ApiError.js'
import { assertBranchAccess } from '../middleware/auth.js'
import { businessDayRange, businessDateStamp } from '../utils/time.js'
import { ORDER_STATUS, STAFF_ROLE } from '../config/constants.js'

/** How many distinct products to list in the "what sold" section. */
const TOP_ITEMS_LIMIT = 10

/**
 * Which branch's numbers this request may read.
 *
 * The same rule as the order board, and deliberately the same shape: an admin sees every
 * branch and may narrow to one, a manager is pinned to their own. Takings are the most
 * sensitive number in the system — a manager who could read another shop's daily total
 * knows exactly how their branch is being measured against it.
 */
function scopeBranch(actor, requestedBranchId) {
  if (actor.role === STAFF_ROLE.ADMIN) return requestedBranchId ?? null

  if (requestedBranchId) assertBranchAccess(actor, requestedBranchId)

  const own = actor.branchId?._id ?? actor.branchId
  if (!own) throw ApiError.internal('This account has no branch assigned')

  return own
}

/**
 * The numbers themselves, over whatever window the caller matched.
 *
 * Shared by the daily report and the running total so the two can never disagree about
 * what "takings" means — a second implementation of that is a second answer, and both
 * end up on a screen somebody reconciles a till against.
 */
async function compute(match) {
  // One pass, faceted rather than four round trips. A day at one branch is hundreds of
  // documents; even all-time for this shop is thousands, so this stays cheap.
  const [facets] = await Order.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],

        takings: [
          { $match: { status: ORDER_STATUS.COMPLETED } },
          {
            $group: {
              _id: '$fulfilment',
              orders: { $sum: 1 },
              gross: { $sum: '$totals.grandTotal' },
              delivery: { $sum: '$totals.deliveryFee' },
              net: { $sum: '$totals.subtotal' },
            },
          },
        ],

        failures: [
          { $match: { status: ORDER_STATUS.FAILED } },
          { $group: { _id: '$failureReason', count: { $sum: 1 } } },
        ],

        // Items are counted from completed orders only, for the same reason takings are:
        // a tray emptied for an order that was refused at the door did not sell.
        topItems: [
          { $match: { status: ORDER_STATUS.COMPLETED } },
          { $unwind: '$items' },
          {
            $group: {
              _id: { $ifNull: ['$items.sku', '$items.name'] },
              name: { $first: '$items.name' },
              qty: { $sum: '$items.qty' },
              revenue: { $sum: '$items.lineTotal' },
            },
          },
          { $sort: { qty: -1 } },
          { $limit: TOP_ITEMS_LIMIT },
        ],

        /** When trading actually started and stopped inside this window, so an all-time
         *  total can say what "all time" turned out to mean. */
        span: [
          { $group: { _id: null, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
        ],
      },
    },
  ])

  const byStatus = Object.fromEntries(
    Object.values(ORDER_STATUS).map((status) => [
      status,
      facets.byStatus.find((row) => row._id === status)?.count ?? 0,
    ])
  )

  const takings = facets.takings.reduce(
    (total, row) => ({
      orders: total.orders + row.orders,
      gross: total.gross + row.gross,
      deliveryFees: total.deliveryFees + row.delivery,
      net: total.net + row.net,
    }),
    { orders: 0, gross: 0, deliveryFees: 0, net: 0 }
  )

  return {
    ordersPlaced: Object.values(byStatus).reduce((total, count) => total + count, 0),
    byStatus,
    takings,
    byFulfilment: facets.takings.map((row) => ({
      fulfilment: row._id,
      orders: row.orders,
      gross: row.gross,
    })),
    failures: facets.failures.map((row) => ({
      reason: row._id ?? 'unspecified',
      count: row.count,
    })),
    topItems: facets.topItems.map((row) => ({
      sku: row._id,
      name: row.name,
      qty: row.qty,
      revenue: row.revenue,
    })),
    firstOrderAt: facets.span[0]?.first ?? null,
    lastOrderAt: facets.span[0]?.last ?? null,
  }
}

/** An aggregation pipeline is not schema-aware, so a string id from a query would match
 *  nothing at all rather than failing loudly. */
const branchMatch = (id) => new mongoose.Types.ObjectId(String(id))

/**
 * A day's trading, for one branch or all of them.
 *
 * `date` defaults to today in business time rather than server time — a manager opening
 * the report at 1am is still working the day that started at 11am yesterday.
 */
export async function daily({ date, branchId } = {}, actor) {
  const day = date ?? businessDateStamp()
  const { start, end } = businessDayRange(day)

  const scopedBranch = scopeBranch(actor, branchId)

  const match = { createdAt: { $gte: start, $lt: end } }
  if (scopedBranch) match.branchId = branchMatch(scopedBranch)

  return {
    date: day,
    branchId: scopedBranch ? String(scopedBranch) : null,
    ...(await compute(match)),
  }
}

/**
 * Everything taken over a span of days — or over all of them.
 *
 * `from` and `to` are inclusive calendar dates in Asia/Karachi, and both are optional:
 * omitting them is the running total since the shop opened, which is the question
 * "what have we made so far" actually asks. Omitting only one is an open-ended range,
 * so "since 13 August" needs no end date invented for it.
 *
 * The window is built from the same `businessDayRange` the daily report uses, so a range
 * ending on the 18th includes the whole of the 18th — including the small hours after
 * midnight, which belong to the 18th's trading and not the 19th's.
 */
export async function summary({ from, to, branchId } = {}, actor) {
  const scopedBranch = scopeBranch(actor, branchId)

  const match = {}
  if (from || to) {
    match.createdAt = {}
    if (from) match.createdAt.$gte = businessDayRange(from).start
    if (to) match.createdAt.$lt = businessDayRange(to).end
  }
  if (scopedBranch) match.branchId = branchMatch(scopedBranch)

  return {
    from: from ?? null,
    to: to ?? null,
    branchId: scopedBranch ? String(scopedBranch) : null,
    ...(await compute(match)),
  }
}
