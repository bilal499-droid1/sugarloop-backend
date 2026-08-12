import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { Order } from '../models/Order.js'
import { orderView } from './orderView.js'

const STAFF_ID = new mongoose.Types.ObjectId()

const order = (overrides = {}) =>
  new Order({
    orderNumber: 'SL-260810-0042',
    contact: { name: 'Ayesha Khan', phone: '+923001234567', email: 'a@example.com' },
    branchId: new mongoose.Types.ObjectId(),
    branchCode: 'DHA2',
    fulfilment: 'delivery',
    address: {
      line1: 'House 12, Street 4',
      area: 'Sector E',
      city: 'Islamabad',
      location: { type: 'Point', coordinates: [73.1574, 33.5312] },
      notes: 'Blue gate',
    },
    distanceKm: 1.2,
    items: [
      {
        kind: 'product',
        productId: new mongoose.Types.ObjectId(),
        sku: 'DON-KITKAT-CRUNCH',
        name: 'KitKat Crunch',
        unitPrice: 42_900,
        qty: 2,
        lineTotal: 85_800,
        netAmount: 85_800,
        taxRate: 0,
        taxAmount: 0,
        grossAmount: 85_800,
      },
    ],
    totals: { subtotal: 85_800, deliveryFee: 10_000, discount: 0, tax: 0, grandTotal: 95_800 },
    promisedAt: new Date('2026-08-10T09:45:00Z'),
    statusHistory: [
      { status: 'placed', at: new Date(), by: 'system' },
      { status: 'confirmed', at: new Date(), by: STAFF_ID, note: 'Called to confirm' },
    ],
    meta: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0', source: 'web' },
    ...overrides,
  })

test('the customer view shows what they need', () => {
  const view = orderView.customer(order())

  assert.equal(view.orderNumber, 'SL-260810-0042')
  assert.equal(view.status, 'placed')
  assert.equal(view.fulfilment, 'delivery')
  assert.equal(view.totals.grandTotal.formatted, 'Rs 958')
  assert.equal(view.items[0].name, 'KitKat Crunch')
  assert.equal(view.payment.method, 'cod')
  assert.equal(view.address.line1, 'House 12, Street 4')
})

test('the customer view never leaks the internal trail', async (t) => {
  const view = orderView.customer(order())
  const serialised = JSON.stringify(view)

  await t.test('no IP or user agent', () => {
    assert.equal(view.meta, undefined)
    assert.ok(!serialised.includes('203.0.113.9'), 'customer IP must not be published')
    assert.ok(!serialised.includes('Mozilla'))
  })

  await t.test('no statusHistory — it names staff', () => {
    assert.equal(view.statusHistory, undefined)
    assert.ok(!serialised.includes(String(STAFF_ID)), 'staff ids must not reach a customer')
  })

  await t.test('no dormant fiscal fields, no internal ids', () => {
    assert.equal(view.fiscal, undefined)
    assert.equal(view.customerId, undefined)
    assert.equal(view.id, undefined)
    assert.equal(view.branchId, undefined)
    assert.equal(view._id, undefined)
  })

  await t.test('no coordinates — they typed the address, they know where they live', () => {
    assert.equal(view.address.location, undefined)
    assert.equal(view.distanceKm, undefined)
  })
})

test('the staff view adds what a branch needs to work the order', () => {
  const view = orderView.staff(order())

  assert.equal(view.orderNumber, 'SL-260810-0042')
  assert.equal(view.distanceKm, 1.2)
  assert.equal(view.contact.email, 'a@example.com')

  // A rider needs a pin, not a street name.
  assert.deepEqual(view.address.location, { lat: 33.5312, lng: 73.1574 })

  // The trail: who moved it, when, why.
  assert.equal(view.statusHistory.length, 2)
  assert.equal(view.statusHistory[0].by, 'system')
  assert.equal(view.statusHistory[1].by, String(STAFF_ID))
  assert.equal(view.statusHistory[1].note, 'Called to confirm')
})

test('even the staff view withholds the customer IP', () => {
  // Nothing on a dashboard needs it. It is for an admin investigating fraud, through the
  // database, with a reason to look.
  const view = orderView.staff(order())

  assert.equal(view.meta, undefined)
  assert.ok(!JSON.stringify(view).includes('203.0.113.9'))
})

test('a pickup order has no address in either view', () => {
  const pickup = order({ fulfilment: 'pickup', address: null, distanceKm: null })

  assert.equal(orderView.customer(pickup).address, null)
  assert.equal(orderView.staff(pickup).address, null)
})

test('a box line is itemised so it can be reordered', () => {
  const boxed = order({
    items: [
      {
        kind: 'box',
        name: 'Box of 2',
        unitPrice: 61_400,
        qty: 1,
        lineTotal: 61_400,
        boxSize: 2,
        children: [
          { sku: 'DON-KITKAT-CRUNCH', name: 'KitKat Crunch', unitPrice: 42_900 },
          { sku: 'DON-CLASSIC-OREO', name: 'Classic Oreo', unitPrice: 18_500 },
        ],
        netAmount: 61_400,
        taxRate: 0,
        taxAmount: 0,
        grossAmount: 61_400,
      },
    ],
  })

  const [item] = orderView.customer(boxed).items

  assert.equal(item.kind, 'box')
  assert.equal(item.boxSize, 2)
  assert.deepEqual(
    item.children.map((c) => c.name),
    ['KitKat Crunch', 'Classic Oreo']
  )
})

test('a failed order carries its reason to the customer', () => {
  const failed = order({ status: 'failed', failureReason: 'no_answer' })

  assert.equal(orderView.customer(failed).status, 'failed')
  assert.equal(orderView.customer(failed).failureReason, 'no_answer')
})
