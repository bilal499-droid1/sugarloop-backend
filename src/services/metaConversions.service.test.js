import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import mongoose from 'mongoose'

import { Order } from '../models/Order.js'
import { buildPurchaseEvent, metaEventId, sendPurchase } from './metaConversions.service.js'
import { orderView } from '../views/orderView.js'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

const NOW = new Date('2026-09-17T14:00:00+05:00')

const order = (overrides = {}) =>
  new Order({
    orderNumber: 'SL-260917-0007',
    contact: { name: 'Ayesha  Khan Niazi', phone: '+923001234567', email: 'ayesha@example.com' },
    branchId: new mongoose.Types.ObjectId(),
    branchCode: 'DHA2',
    fulfilment: 'delivery',
    address: {
      line1: 'House 12, Street 4',
      city: 'Islamabad',
      location: { type: 'Point', coordinates: [73.1574, 33.5312] },
    },
    items: [
      {
        kind: 'product',
        sku: 'DON-KITKAT-CRUNCH',
        name: 'KitKat Crunch',
        unitPrice: 42_900,
        qty: 2,
        lineTotal: 85_800,
        netAmount: 85_800,
        grossAmount: 85_800,
      },
      {
        kind: 'box',
        productId: new mongoose.Types.ObjectId(),
        name: 'Box of 6',
        unitPrice: 150_000,
        qty: 1,
        lineTotal: 150_000,
        boxSize: 6,
        netAmount: 150_000,
        grossAmount: 150_000,
      },
    ],
    totals: { subtotal: 235_800, deliveryFee: 10_000, discount: 0, tax: 0, grandTotal: 245_800 },
    promisedAt: NOW,
    ...overrides,
  })

test('the event id is stable and is what the customer view hands the Pixel', () => {
  const placed = order()
  assert.equal(metaEventId(placed), 'purchase_SL-260917-0007')
  assert.equal(orderView.customer(placed).metaEventId, 'purchase_SL-260917-0007')
})

test('amounts reach Meta in rupees, not stored hundredths', () => {
  const { custom_data: data } = buildPurchaseEvent(order(), {}, { now: NOW })

  assert.equal(data.currency, 'PKR')
  assert.equal(data.value, 2458)
  assert.equal(data.contents[0].item_price, 429)
  assert.equal(data.num_items, 3)
  assert.equal(data.order_id, 'SL-260917-0007')
})

test('a box line without a sku is still identified', () => {
  const placed = order()
  const { custom_data: data } = buildPurchaseEvent(placed, {}, { now: NOW })

  assert.deepEqual(data.content_ids, ['DON-KITKAT-CRUNCH', String(placed.items[1].productId)])
})

test('personal details leave only as normalised SHA-256 hashes', () => {
  const event = buildPurchaseEvent(
    order(),
    { ip: '203.0.113.9', userAgent: 'Mozilla/5.0', fbp: 'fb.1.1.2', fbc: 'fb.1.1.abc' },
    { now: NOW }
  )
  const user = event.user_data

  assert.deepEqual(user.ph, [sha('923001234567')])
  assert.deepEqual(user.em, [sha('ayesha@example.com')])
  assert.deepEqual(user.fn, [sha('ayesha')])
  assert.deepEqual(user.ln, [sha('khanniazi')])
  assert.deepEqual(user.ct, [sha('islamabad')])
  assert.deepEqual(user.country, [sha('pk')])
  assert.equal(user.fbc, 'fb.1.1.abc')
  assert.equal(user.client_ip_address, '203.0.113.9')

  const serialised = JSON.stringify(event)
  for (const raw of ['923001234567', 'ayesha@example.com', 'Islamabad', 'Khan']) {
    assert.ok(!serialised.includes(raw), `${raw} must not be sent in the clear`)
  }
})

test('missing details are left out rather than sent empty', () => {
  const placed = order({ contact: { name: 'Ayesha', phone: null, email: 'a@example.com' } })
  const { user_data: user } = buildPurchaseEvent(placed, {}, { now: NOW })

  assert.equal(user.ph, undefined)
  assert.equal(user.ln, undefined)
  assert.equal(user.fbc, undefined)
  assert.equal(user.client_ip_address, undefined)
})

test('pickup orders carry no city', () => {
  const { user_data: user } = buildPurchaseEvent(order({ fulfilment: 'pickup', address: null }), {}, {
    now: NOW,
  })
  assert.equal(user.ct, undefined)
})

test('nothing is sent while unconfigured', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  await sendPurchase(order(), {}, { now: NOW })
  assert.equal(fetchMock.mock.callCount(), 0)
})
