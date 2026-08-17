import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { Order } from '../models/Order.js'
import { Counter } from '../models/Counter.js'
import { Branch } from '../models/Branch.js'
import { Product } from '../models/Product.js'
import { BranchStock } from '../models/BranchStock.js'
import * as orderService from './order.service.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Integration tests. These need a real MongoDB, because what they check — atomic sequence
 * allocation under concurrency, and unique-index behaviour — cannot be observed against a
 * stub. Everything provable without a database is already covered in pricing.engine.test.js.
 *
 * The suite SKIPS rather than fails when Mongo is unreachable, so `npm test` stays green on
 * a machine without one. CI runs a Mongo service, where these actually execute.
 */
const { connected, skip } = await connectTestDatabase('order')

/** Mid-service on a fixed date, so order numbers are predictable. */
const NOW = new Date('2026-08-10T14:00:00+05:00')

let branch
let kitkat
let oreo

async function seedFixtures() {
  await Promise.all([
    Order.deleteMany({}),
    Counter.deleteMany({}),
    Branch.deleteMany({}),
    Product.deleteMany({}),
    BranchStock.deleteMany({}),
  ])

  branch = await Branch.create({
    name: 'Sugar Loop DHA 2',
    code: 'DHA2',
    address: 'Nadir Arcade',
    city: 'Islamabad',
    phone: '+92 51 111 557 799',
    location: { type: 'Point', coordinates: [73.1574172, 33.5312498] },
    hours: { open: '11:00', close: '03:00' },
    lastOrderBufferMinutes: 30,
  })

  kitkat = await Product.create({
    sku: 'DON-KITKAT-CRUNCH',
    slug: 'kitkat-crunch',
    name: 'KitKat Crunch',
    category: 'Donuts',
    price: 42_900,
    boxEligible: true,
  })

  oreo = await Product.create({
    sku: 'DON-CLASSIC-OREO',
    slug: 'classic-oreo',
    name: 'Classic Oreo',
    category: 'Donuts',
    price: 18_500,
    boxEligible: true,
  })

  await BranchStock.create([
    { branchId: branch._id, productId: kitkat._id, inStock: true },
    { branchId: branch._id, productId: oreo._id, inStock: true },
  ])
}

const request = (overrides = {}) => ({
  fulfilment: 'pickup',
  branchCode: 'DHA2',
  contact: { name: 'Ayesha Khan', phone: '+923001234567' },
  items: [{ kind: 'product', productId: String(kitkat._id), qty: 2 }],
  expectedTotal: 85_800,
  ...overrides,
})

test('order service', { skip, concurrency: false }, async (t) => {
  t.beforeEach(seedFixtures)
  t.after(() => disconnectTestDatabase(connected))

  await t.test('numbers an order SL-YYMMDD-NNNN, sequentially', async () => {
    const first = await orderService.create(request(), {}, { now: NOW })
    const second = await orderService.create(request(), {}, { now: NOW })

    assert.equal(first.orderNumber, 'SL-260810-0001')
    assert.equal(second.orderNumber, 'SL-260810-0002')
  })

  await t.test('the sequence restarts on a new date', async () => {
    await orderService.create(request(), {}, { now: NOW })

    const nextDay = new Date('2026-08-11T14:00:00+05:00')
    const tomorrow = await orderService.create(request(), {}, { now: nextDay })

    assert.equal(tomorrow.orderNumber, 'SL-260811-0001')
  })

  await t.test('concurrent orders get different numbers', async () => {
    // The acceptance check. Counting existing orders and adding one produces duplicates
    // the first time two customers check out in the same second; an atomic $inc does not.
    const placed = await Promise.all(
      Array.from({ length: 25 }, () => orderService.create(request(), {}, { now: NOW }))
    )

    const numbers = placed.map((order) => order.orderNumber)

    assert.equal(new Set(numbers).size, 25, 'every order number is distinct')
    assert.deepEqual(
      [...numbers].sort(),
      Array.from({ length: 25 }, (_, i) => `SL-260810-${String(i + 1).padStart(4, '0')}`).sort()
    )
  })

  await t.test('rejects when the price moved since the quote', async () => {
    // The customer was quoted Rs 858. An admin raises the price before they submit.
    await Product.updateOne({ _id: kitkat._id }, { $set: { price: 45_000 } })

    await assert.rejects(
      () => orderService.create(request(), {}, { now: NOW }),
      (err) => {
        assert.equal(err.statusCode, 409)
        assert.equal(err.code, 'PRICE_CHANGED')
        assert.equal(err.details.quotedTotal, 85_800)
        assert.equal(err.details.currentTotal, 90_000)
        assert.equal(err.details.difference, 4_200)
        return true
      }
    )

    assert.equal(await Order.countDocuments(), 0, 'nothing was written')
  })

  await t.test('a rejected order burns no order number', async () => {
    await orderService.create(request(), {}, { now: NOW })

    await assert.rejects(
      () => orderService.create(request({ expectedTotal: 1 }), {}, { now: NOW })
    )

    // Gaps in a sequential order book are what make an accountant ask which orders went
    // missing — so the number is allocated only after pricing succeeds.
    const next = await orderService.create(request(), {}, { now: NOW })
    assert.equal(next.orderNumber, 'SL-260810-0002')
  })

  await t.test('an item that sold out since the quote is rejected at order time', async () => {
    await BranchStock.updateOne(
      { branchId: branch._id, productId: kitkat._id },
      { $set: { inStock: false } }
    )

    await assert.rejects(
      () => orderService.create(request(), {}, { now: NOW }),
      (err) => err.code === 'ITEMS_UNAVAILABLE' && err.details.outOfStock.includes('KitKat Crunch')
    )
  })

  await t.test('the branch closing between quote and order is rejected', async () => {
    const afterCutoff = new Date('2026-08-11T02:31:00+05:00')

    await assert.rejects(
      () => orderService.create(request(), {}, { now: afterCutoff }),
      (err) => err.code === 'BRANCH_NOT_ACCEPTING_ORDERS'
    )
  })

  await t.test('name, sku and price are snapshotted onto the line', async () => {
    const order = await orderService.create(request(), {}, { now: NOW })

    // A later price change must not rewrite what this customer was charged.
    await Product.updateOne({ _id: kitkat._id }, { $set: { price: 99_900, name: 'Renamed' } })

    const reread = await Order.findById(order._id)

    assert.equal(reread.items[0].name, 'KitKat Crunch')
    assert.equal(reread.items[0].sku, 'DON-KITKAT-CRUNCH')
    assert.equal(reread.items[0].unitPrice, 42_900)
    assert.equal(reread.totals.grandTotal, 85_800)
  })

  await t.test('starts as placed, with the transition recorded', async () => {
    const order = await orderService.create(request(), {}, { now: NOW })

    assert.equal(order.status, 'placed')
    assert.equal(order.statusHistory.length, 1)
    assert.equal(order.statusHistory[0].status, 'placed')
    assert.equal(order.statusHistory[0].by, 'system')
    assert.equal(order.payment.method, 'cod')
    assert.equal(order.payment.status, 'pending')
    assert.equal(order.fiscal.status, 'not_applicable')
    // promisedAt is 45 minutes out: cook plus travel.
    assert.equal(order.promisedAt.getTime() - NOW.getTime(), 45 * 60_000)
  })

  await t.test('a delivery order stores the address and the distance', async () => {
    const order = await orderService.create(
      request({
        fulfilment: 'delivery',
        branchCode: undefined,
        location: { lat: 33.5312, lng: 73.1574 },
        address: { line1: 'House 12, Street 4', area: 'Sector E', city: 'Islamabad' },
        expectedTotal: 95_800, // + Rs 100 delivery
      }),
      {},
      { now: NOW }
    )

    assert.equal(order.totals.deliveryFee, 10_000)
    assert.equal(order.address.line1, 'House 12, Street 4')
    assert.deepEqual(order.address.location.coordinates, [73.1574, 33.5312])
    assert.ok(order.distanceKm !== null)
  })

  await t.test('the fraud trail is stored but never part of the customer view', async () => {
    const order = await orderService.create(
      request(),
      { ip: '203.0.113.9', userAgent: 'Mozilla/5.0' },
      { now: NOW }
    )

    assert.equal(order.meta.ip, '203.0.113.9', 'stored for an unpaid COD order')
  })

  await t.test('lookup by number requires the phone it was placed with', async () => {
    const order = await orderService.create(request(), {}, { now: NOW })

    const found = await orderService.getByNumber(order.orderNumber, { phone: '+923001234567' })
    assert.equal(found.orderNumber, order.orderNumber)

    // Order numbers are sequential and enumerable. A wrong phone gets 404, not 403 —
    // confirming the order exists but belongs to someone else is the same leak.
    await assert.rejects(
      () => orderService.getByNumber(order.orderNumber, { phone: '+923009999999' }),
      (err) => err.statusCode === 404
    )
  })

  await t.test('order numbers are unique at the database level too', async () => {
    await orderService.create(request(), {}, { now: NOW })
    const duplicate = await Order.findOne({}).lean()

    await assert.rejects(
      () => Order.create({ ...duplicate, _id: new mongoose.Types.ObjectId() }),
      (err) => err.code === 11000,
      'the unique index is the last line of defence'
    )
  })
})
