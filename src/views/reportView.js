/**
 * Response shapes for the reports.
 *
 * Every amount gets a formatted twin, the same as `quoteView` — a report is read by a
 * person, and the one place a stored amount must never leak raw is a screen showing
 * takings, where `69800` reads as sixty-nine thousand rupees to anyone not in on the
 * convention.
 */
import { formatPKR } from '../utils/money.js'

const money = (amount) => ({ amount, formatted: formatPKR(amount) })

/** Everything both reports share. The only difference between them is the window they
 *  cover, so the period fields are all each adds on top. */
const body = (report) => ({
  ordersPlaced: report.ordersPlaced,
  byStatus: report.byStatus,

  takings: {
    orders: report.takings.orders,
    gross: money(report.takings.gross),
    net: money(report.takings.net),
    deliveryFees: money(report.takings.deliveryFees),
  },

  byFulfilment: report.byFulfilment.map((row) => ({
    fulfilment: row.fulfilment,
    orders: row.orders,
    gross: money(row.gross),
  })),

  failures: report.failures,

  topItems: report.topItems.map((row) => ({
    sku: row.sku,
    name: row.name,
    qty: row.qty,
    revenue: money(row.revenue),
  })),
})

export const reportView = {
  daily: (report) => ({
    date: report.date,
    branchId: report.branchId,
    ...body(report),
  }),

  summary: (report) => ({
    from: report.from,
    to: report.to,
    branchId: report.branchId,
    /** What "all time" turned out to mean, so the screen can say "since 13 Aug" rather
     *  than leaving the reader to guess how far back the number reaches. */
    firstOrderAt: report.firstOrderAt,
    lastOrderAt: report.lastOrderAt,
    ...body(report),
  }),
}
