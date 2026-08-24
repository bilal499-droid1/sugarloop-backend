import test from 'node:test'
import assert from 'node:assert/strict'

import { renderDailyReport, dailyReportFilename } from './reportPdf.service.js'
import { FAILURE_REASON } from '../config/constants.js'

/** No database — rendering takes the report service's own shape and returns bytes. */

const branch = { code: 'DHA2', name: 'Sugar Loop DHA 2' }

const report = {
  date: '2026-08-24',
  branchId: '6a8b69bd0b2555f5fa4f0d05',
  ordersPlaced: 12,
  byStatus: {
    placed: 1,
    confirmed: 0,
    preparing: 2,
    out_for_delivery: 1,
    ready_for_pickup: 0,
    completed: 7,
    failed: 1,
  },
  takings: { orders: 7, gross: 670_600, net: 600_600, deliveryFees: 70_000 },
  byFulfilment: [
    { fulfilment: 'delivery', orders: 5, gross: 500_000 },
    { fulfilment: 'pickup', orders: 2, gross: 170_600 },
  ],
  failures: [{ reason: FAILURE_REASON.NO_ANSWER, count: 1 }],
  topItems: [
    { sku: 'DON-KITKAT-CRUNCH', name: 'KitKat Crunch', qty: 9, revenue: 386_100 },
    { sku: 'DON-CLASSIC-OREO', name: 'Classic Oreo', qty: 4, revenue: 74_000 },
  ],
}

const isPdf = (buffer) => buffer.subarray(0, 5).toString() === '%PDF-'

test('a daily report renders to a PDF', async () => {
  const pdf = await renderDailyReport(report, { branch })

  assert.ok(Buffer.isBuffer(pdf))
  assert.ok(isPdf(pdf))
  assert.ok(pdf.length > 500)
})

test('an all-branches report renders without a branch', async () => {
  const pdf = await renderDailyReport({ ...report, branchId: null })

  assert.ok(isPdf(pdf))
})

/** The empty day is the one most likely to hit an unguarded `.map` or a zero divide. */
test('a day with no trading renders rather than throwing', async () => {
  const pdf = await renderDailyReport({
    date: '2026-08-09',
    branchId: null,
    ordersPlaced: 0,
    byStatus: {
      placed: 0,
      confirmed: 0,
      preparing: 0,
      out_for_delivery: 0,
      ready_for_pickup: 0,
      completed: 0,
      failed: 0,
    },
    takings: { orders: 0, gross: 0, net: 0, deliveryFees: 0 },
    byFulfilment: [],
    failures: [],
    topItems: [],
  })

  assert.ok(isPdf(pdf))
})

test('the filename names the day and the branch', () => {
  assert.equal(dailyReportFilename(report, branch), 'sugarloop-2026-08-24-DHA2.pdf')
  assert.equal(dailyReportFilename(report, null), 'sugarloop-2026-08-24-all-branches.pdf')
})

/* -------------------------------------------------------------------------- */
/* The running total — same body, a different period heading                   */
/* -------------------------------------------------------------------------- */

/** A summary carries `from`/`to` instead of `date`, either of which may be null. */
const summary = {
  ...report,
  date: undefined,
  from: null,
  to: null,
  firstOrderAt: new Date('2026-08-13T14:00:00+05:00'),
  lastOrderAt: new Date('2026-08-24T12:53:00+05:00'),
}

test('an all-time summary renders and names its span', async () => {
  const pdf = await renderDailyReport(summary, { branch })

  assert.ok(isPdf(pdf))
  assert.equal(dailyReportFilename(summary, branch), 'sugarloop-all-time-DHA2.pdf')
})

test('a dated range renders and names both ends', async () => {
  const ranged = { ...summary, from: '2026-08-13', to: '2026-08-18' }

  assert.ok(isPdf(await renderDailyReport(ranged, { branch })))
  assert.equal(
    dailyReportFilename(ranged, branch),
    'sugarloop-2026-08-13-to-2026-08-18-DHA2.pdf'
  )
})

/** An all-time total of a shop that never traded has no span to print. */
test('an all-time summary with no trading still renders', async () => {
  const pdf = await renderDailyReport({
    ...summary,
    firstOrderAt: null,
    lastOrderAt: null,
    ordersPlaced: 0,
    byStatus: { placed: 0, confirmed: 0, preparing: 0, out_for_delivery: 0, ready_for_pickup: 0, completed: 0, failed: 0 },
    takings: { orders: 0, gross: 0, net: 0, deliveryFees: 0 },
    byFulfilment: [],
    failures: [],
    topItems: [],
  })

  assert.ok(isPdf(pdf))
})
