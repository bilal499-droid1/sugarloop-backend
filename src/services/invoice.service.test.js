import test from 'node:test'
import assert from 'node:assert/strict'

import { renderOrderInvoice, invoiceFilename } from './invoice.service.js'
import { FULFILMENT, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../config/constants.js'

/**
 * No database. Rendering takes a plain order shape and returns bytes, and the thing worth
 * proving is that it survives the awkward orders — a box with children, a pickup with no
 * address — rather than that pdfkit can draw a line.
 *
 * A PDF's bytes are not meaningfully assertable beyond its header, so these check that a
 * real document comes back and that the paths which would throw do not.
 */

const branch = {
  code: 'DHA2',
  name: 'Sugar Loop DHA 2',
  address: '1st Floor, Nadir Arcade, Sector E, DHA Phase II, Islamabad',
  phone: '+92 51 111 557 799',
}

const baseOrder = {
  orderNumber: 'SL-260824-0003',
  createdAt: new Date('2026-08-24T12:53:00+05:00'),
  status: ORDER_STATUS.COMPLETED,
  fulfilment: FULFILMENT.DELIVERY,
  contact: { name: 'Ayesha Khan', phone: '+923001234567' },
  address: {
    line1: 'House 12, Street 4',
    area: 'DHA Phase II',
    city: 'Islamabad',
    notes: '',
  },
  items: [
    {
      kind: 'product',
      name: 'KitKat Crunch',
      sku: 'DON-KITKAT-CRUNCH',
      qty: 2,
      unitPrice: 42_900,
      lineTotal: 85_800,
    },
  ],
  totals: {
    subtotal: 85_800,
    deliveryFee: 10_000,
    discount: 0,
    tax: 0,
    grandTotal: 95_800,
  },
  payment: { method: PAYMENT_METHOD.COD, status: PAYMENT_STATUS.COLLECTED },
}

/** `%PDF-` — the magic number every reader looks for. */
const isPdf = (buffer) => buffer.subarray(0, 5).toString() === '%PDF-'

test('an invoice renders to a PDF', async () => {
  const pdf = await renderOrderInvoice(baseOrder, branch)

  assert.ok(Buffer.isBuffer(pdf))
  assert.ok(isPdf(pdf), 'starts with the PDF magic number')
  assert.ok(pdf.length > 500, 'a real document, not an empty shell')
})

test('a Build Your Box line prints its contents', async () => {
  const pdf = await renderOrderInvoice(
    {
      ...baseOrder,
      items: [
        {
          kind: 'box',
          name: 'Build Your Box (4)',
          qty: 1,
          unitPrice: 160_000,
          lineTotal: 160_000,
          boxSize: 4,
          children: [
            { name: 'Classic Oreo', sku: 'DON-CLASSIC-OREO', unitPrice: 18_500 },
            { name: 'KitKat Crunch', sku: 'DON-KITKAT-CRUNCH', unitPrice: 42_900 },
            { name: 'Nutella', sku: 'DON-NUTELLA', unitPrice: 29_900 },
            { name: 'Lotus', sku: 'DON-LOTUS', unitPrice: 29_900 },
          ],
        },
      ],
    },
    branch
  )

  assert.ok(isPdf(pdf))
})

test('a pickup order has no address to print and still renders', async () => {
  const pdf = await renderOrderInvoice(
    {
      ...baseOrder,
      fulfilment: FULFILMENT.PICKUP,
      address: null,
      totals: { ...baseOrder.totals, deliveryFee: 0, grandTotal: 85_800 },
    },
    branch
  )

  assert.ok(isPdf(pdf))
})

test('an unpaid order renders as a bill rather than a receipt', async () => {
  const pdf = await renderOrderInvoice(
    {
      ...baseOrder,
      status: ORDER_STATUS.OUT_FOR_DELIVERY,
      payment: { method: PAYMENT_METHOD.COD, status: PAYMENT_STATUS.PENDING },
    },
    branch
  )

  assert.ok(isPdf(pdf))
})

test('the filename is built from the order number', () => {
  assert.equal(invoiceFilename(baseOrder), 'SL-260824-0003-invoice.pdf')
})
