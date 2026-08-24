/**
 * The daily report, as PDF — the version that gets printed and kept.
 *
 * Separate from `invoice.service.js` rather than sharing a "PDF helpers" module: the two
 * documents have almost nothing in common beyond using the same library, and a shared
 * layout layer between two documents is the kind of abstraction that makes changing one
 * of them break the other.
 */
import PDFDocument from 'pdfkit'
import { formatPKR } from '../utils/money.js'
import { BUSINESS_TIMEZONE } from '../config/constants.js'

const INK = '#1f2937'
const MUTED = '#6b7280'
const RULE = '#d1d5db'

const PAGE_MARGIN = 50
const CONTENT_WIDTH = 512

function sectionHeading(doc, text, left) {
  doc.moveDown(1)
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text(text.toUpperCase(), left)
  doc.moveDown(0.3)
  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(left, doc.y)
    .lineTo(left + CONTENT_WIDTH, doc.y)
    .stroke()
  doc.moveDown(0.5)
}

function labelledRow(doc, label, value, left, { bold = false } = {}) {
  const top = doc.y
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10)
  doc.fillColor(bold ? INK : MUTED).text(label, left, top, { width: 300 })
  doc.fillColor(INK).text(value, left + 300, top, { width: 212, align: 'right' })
  doc.moveDown(0.4)
}

const asDate = (value) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIMEZONE, dateStyle: 'medium' }).format(
    new Date(value)
  )

/**
 * What this document covers, worked out from the report's own shape rather than passed in.
 *
 * A daily report carries `date`; a running total carries `from`/`to`, either of which may
 * be absent. An all-time total with no trading in it has no span to name, so it says so
 * instead of printing an invented range.
 */
function describePeriod(report) {
  if (report.date) return { title: 'Daily report', period: report.date }

  if (report.from && report.to) {
    return { title: 'Sales summary', period: `${asDate(report.from)} — ${asDate(report.to)}` }
  }
  if (report.from) return { title: 'Sales summary', period: `Since ${asDate(report.from)}` }
  if (report.to) return { title: 'Sales summary', period: `Up to ${asDate(report.to)}` }

  return {
    title: 'Sales summary',
    period: report.firstOrderAt
      ? `All time — ${asDate(report.firstOrderAt)} to ${asDate(report.lastOrderAt)}`
      : 'All time',
  }
}

/**
 * `report` is the service's own shape (stored amounts), not the view's — the PDF formats
 * money itself, so handing it the view would mean unwrapping `{ amount, formatted }` twice.
 */
export function renderDailyReport(report, { branch } = {}) {
  const { title, period } = describePeriod(report)
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))

  const left = PAGE_MARGIN
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(title, left, PAGE_MARGIN)
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
  doc.text(period)
  doc.text(branch ? `${branch.name} (${branch.code})` : 'All branches')
  doc.fontSize(8).text(
    `Generated ${new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date())} — Asia/Karachi`
  )

  sectionHeading(doc, 'Takings', left)
  // Spelled out rather than left as a bare "Takings" heading: the number excludes orders
  // that are still out, and a report that does not say so invites someone to reconcile it
  // against a till float and find it short.
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
  doc.text('Completed orders only — cash collected. Orders still out are not counted.', left, doc.y, {
    width: CONTENT_WIDTH,
  })
  doc.moveDown(0.5)

  labelledRow(doc, 'Orders completed', String(report.takings.orders), left)
  labelledRow(doc, 'Items subtotal', formatPKR(report.takings.net), left)
  labelledRow(doc, 'Delivery fees', formatPKR(report.takings.deliveryFees), left)
  labelledRow(doc, 'Total taken', formatPKR(report.takings.gross), left, { bold: true })

  if (report.byFulfilment.length > 0) {
    sectionHeading(doc, 'By fulfilment', left)
    for (const row of report.byFulfilment) {
      labelledRow(doc, row.fulfilment, `${row.orders} — ${formatPKR(row.gross)}`, left)
    }
  }

  sectionHeading(doc, 'Orders by status', left)
  labelledRow(
    doc,
    report.date ? 'Placed today, all statuses' : 'Placed in this period, all statuses',
    String(report.ordersPlaced),
    left
  )
  for (const [status, count] of Object.entries(report.byStatus)) {
    if (count > 0) labelledRow(doc, status, String(count), left)
  }

  if (report.failures.length > 0) {
    sectionHeading(doc, 'Failures by reason', left)
    for (const row of report.failures) {
      labelledRow(doc, row.reason, String(row.count), left)
    }
  }

  if (report.topItems.length > 0) {
    sectionHeading(doc, 'What sold', left)
    for (const row of report.topItems) {
      labelledRow(doc, `${row.qty} x ${row.name}`, formatPKR(row.revenue), left)
    }
  }

  doc.end()
  return finished
}

/** `2026-08-24` at DHA2 -> `sugarloop-2026-08-24-DHA2.pdf`; a running total ->
 *  `sugarloop-all-time-DHA2.pdf` or `sugarloop-2026-08-13-to-2026-08-18-DHA2.pdf`. */
export function dailyReportFilename(report, branch) {
  const scope = branch?.code ?? 'all-branches'

  if (report.date) return `sugarloop-${report.date}-${scope}.pdf`

  const span = report.from || report.to ? `${report.from ?? 'start'}-to-${report.to ?? 'now'}` : 'all-time'
  return `sugarloop-${span}-${scope}.pdf`
}
