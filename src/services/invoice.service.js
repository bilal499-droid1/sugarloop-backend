/**
 * Order invoices, as PDF.
 *
 * **Everything printed here comes off the order document, never the catalogue.** An order
 * line already snapshots `name`, `sku` and `unitPrice` at the moment it was placed (see
 * `models/Order.js`), and an invoice is the one artefact where that matters most: a price
 * rise next month must not silently reprint last month's receipt at the new number, and a
 * discontinued donut must still print on the invoice of the person who bought one.
 *
 * The document is built into a buffer rather than streamed to the response. An invoice is
 * a couple of kilobytes, and buffering means a failure halfway through rendering is still
 * a clean 500 with the error envelope — once bytes are on the wire the status line is
 * already sent and the customer gets a truncated file instead.
 */
import PDFDocument from 'pdfkit'
import { formatPKR } from '../utils/money.js'
import { BUSINESS_TIMEZONE, FULFILMENT, PAYMENT_STATUS } from '../config/constants.js'

/** Deliberately muted: this prints, and a saturated accent costs ink for no information. */
const INK = '#1f2937'
const MUTED = '#6b7280'
const RULE = '#d1d5db'

const PAGE_MARGIN = 50

/** Where each column starts, measured from the left margin. */
const COL = { item: 0, qty: 300, unit: 350, total: 440 }
const CONTENT_WIDTH = 512

function formatTimestamp(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/**
 * A row of the items table.
 *
 * A Build Your Box line prints its children indented underneath it. They carry no
 * `lineTotal` of their own — the box is what was priced — so they are listed for the
 * customer to see what they actually got, without a money column that would not add up.
 */
function drawItem(doc, item, left) {
  const top = doc.y

  doc.fillColor(INK).fontSize(10).font('Helvetica')
  doc.text(item.name, left + COL.item, top, { width: COL.qty - 20 })

  const rowHeight = doc.y - top

  doc.text(String(item.qty), left + COL.qty, top, { width: 40 })
  doc.text(formatPKR(item.unitPrice), left + COL.unit, top, { width: 80, align: 'right' })
  doc.text(formatPKR(item.lineTotal), left + COL.total, top, { width: 72, align: 'right' })

  doc.y = top + rowHeight

  for (const child of item.children ?? []) {
    doc.fillColor(MUTED).fontSize(9)
    doc.text(`— ${child.name}`, left + COL.item + 12, doc.y, { width: COL.qty - 32 })
  }

  doc.moveDown(0.6)
}

function drawTotalRow(doc, label, amount, left, { bold = false } = {}) {
  const top = doc.y
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10)
  doc.fillColor(bold ? INK : MUTED)
  doc.text(label, left + COL.unit - 60, top, { width: 140, align: 'right' })
  doc.fillColor(INK)
  doc.text(formatPKR(amount), left + COL.total, top, { width: 72, align: 'right' })
  doc.moveDown(0.4)
}

/**
 * The invoice for one order, as a PDF buffer.
 *
 * `branch` is the populated branch document. It is passed in rather than resolved here so
 * the caller controls the query — the staff board and the customer route both already
 * have it populated, and an invoice should not be the thing that fires an extra lookup.
 */
export function renderOrderInvoice(order, branch) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))

  const left = PAGE_MARGIN
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('Sugarloop', left, PAGE_MARGIN)
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
  if (branch?.name) doc.text(branch.name)
  if (branch?.address) doc.text(branch.address, { width: 300 })
  if (branch?.phone) doc.text(branch.phone)

  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
  doc.text('INVOICE', left, PAGE_MARGIN, { width: CONTENT_WIDTH, align: 'right' })
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
  doc.text(order.orderNumber, { width: CONTENT_WIDTH, align: 'right' })
  doc.text(formatTimestamp(order.createdAt), { width: CONTENT_WIDTH, align: 'right' })

  doc.moveDown(2)

  const detailsTop = doc.y
  doc.fillColor(MUTED).fontSize(9).text('BILLED TO', left, detailsTop)
  doc.fillColor(INK).fontSize(10)
  doc.text(order.contact.name)
  doc.text(order.contact.phone)

  if (order.address) {
    const parts = [order.address.line1, order.address.area, order.address.city].filter(Boolean)
    doc.fillColor(MUTED).text(parts.join(', '), { width: 240 })
  }

  doc.fillColor(MUTED).fontSize(9).text('FULFILMENT', left + 300, detailsTop)
  doc.fillColor(INK).fontSize(10)
  doc.text(
    order.fulfilment === FULFILMENT.DELIVERY ? 'Delivery' : 'Pickup',
    left + 300,
    doc.y === detailsTop ? doc.y : undefined
  )
  doc.text(`Status: ${order.status}`, left + 300)
  doc.text(
    // COD: completion is collection, so a completed order's invoice is a receipt for money
    // that is actually in the till. Anything else is still a bill.
    order.payment.status === PAYMENT_STATUS.COLLECTED ? 'Paid — cash on delivery' : 'Payment due',
    left + 300
  )

  doc.moveDown(2)

  const tableTop = doc.y
  doc.fillColor(MUTED).fontSize(9).font('Helvetica-Bold')
  doc.text('ITEM', left + COL.item, tableTop)
  doc.text('QTY', left + COL.qty, tableTop, { width: 40 })
  doc.text('UNIT', left + COL.unit, tableTop, { width: 80, align: 'right' })
  doc.text('TOTAL', left + COL.total, tableTop, { width: 72, align: 'right' })

  doc.moveDown(0.5)
  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(left, doc.y)
    .lineTo(left + CONTENT_WIDTH, doc.y)
    .stroke()
  doc.moveDown(0.6)

  for (const item of order.items) drawItem(doc, item, left)

  doc
    .strokeColor(RULE)
    .moveTo(left + COL.unit - 60, doc.y)
    .lineTo(left + CONTENT_WIDTH, doc.y)
    .stroke()
  doc.moveDown(0.6)

  drawTotalRow(doc, 'Subtotal', order.totals.subtotal, left)
  if (order.totals.deliveryFee > 0) drawTotalRow(doc, 'Delivery', order.totals.deliveryFee, left)
  if (order.totals.discount > 0) drawTotalRow(doc, 'Discount', order.totals.discount, left)
  // Printed at 0% today. It stays on the invoice because an invoice that never showed a
  // tax line is the one nobody notices is missing when the rate stops being zero.
  drawTotalRow(doc, 'Tax', order.totals.tax, left)
  drawTotalRow(doc, 'Total', order.totals.grandTotal, left, { bold: true })

  doc.moveDown(3)
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
  doc.text('Thank you for ordering from Sugarloop.', left, doc.y, {
    width: CONTENT_WIDTH,
    align: 'center',
  })

  doc.end()
  return finished
}

/** `SL-260824-0003` -> `SL-260824-0003-invoice.pdf`. */
export function invoiceFilename(order) {
  return `${order.orderNumber}-invoice.pdf`
}
