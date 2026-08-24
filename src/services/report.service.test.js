import test from 'node:test'
import assert from 'node:assert/strict'

import { Order } from '../models/Order.js'
import { Counter } from '../models/Counter.js'
import { Branch } from '../models/Branch.js'
import { Product } from '../models/Product.js'
import { BranchStock } from '../models/BranchStock.js'
import { StaffUser } from '../models/StaffUser.js'
import { AuditLog } from '../models/AuditLog.js'
import * as orderService from './order.service.js'
import * as staffOrderService from './staffOrder.service.js'
import * as reportService from './report.service.js'
import { FAILURE_REASON, ORDER_STATUS, STAFF_ROLE } from '../config/constants.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Integration tests. The rules worth proving here are all about which orders are counted:
 * takings that exclude anything not yet handed over, and a branch manager who cannot see
 * another shop's numbers. Neither is observable without real documents.
 */
const { connected, skip } = await connectTestDatabase('report')

/** Mid-service, so the branch is open and orders can be placed. */
const NOW = new Date('2026-08-10T14:00:00+05:00')
const BUSINESS_DATE = '2026-08-10'

let dha2
let nust
let donut
let admin
let dha2Manager
let nustManager

const branchFixture = (code, name, coordinates) => ({
  code,
  name,
  address: 'Somewhere in Islamabad',
  city: 'Islamabad',
  phone: '+92 51 111 557 799',
  location: { type: 'Point', coordinates },
  hours: { open: '11:00', close: '03:00' },
  lastOrderBufferMinutes: 30,
})

async function seedFixtures() {
  await Promise.all([
    Order.deleteMany({}),
    Counter.deleteMany({}),
    Branch.deleteMany({}),
    Product.deleteMany({}),
    BranchStock.deleteMany({}),
    StaffUser.deleteMany({}),
    AuditLog.deleteMany({}),
  ])

  dha2 = await Branch.create(branchFixture('DHA2', 'Sugar Loop DHA 2', [73.1574172, 33.5312498]))
  nust = await Branch.create(branchFixture('NUST', 'Sugar Loop NUST H-12', [72.9974445, 33.6461047]))

  donut = await Product.create({
    sku: 'DON-KITKAT-CRUNCH',
    slug: 'kitkat-crunch',
    name: 'KitKat Crunch',
    category: 'Donuts',
    price: 42_900,
    boxEligible: true,
  })

  await BranchStock.create([
    { branchId: dha2._id, productId: donut._id, inStock: true },
    { branchId: nust._id, productId: donut._id, inStock: true },
  ])

  admin = await StaffUser.create({
    name: 'Admin',
    email: 'admin@sugarloop.pk',
    passwordHash: 'a-long-enough-password',
    role: STAFF_ROLE.ADMIN,
    branchId: null,
  })

  dha2Manager = await StaffUser.create({
    name: 'DHA2 Manager',
    email: 'dha2@sugarloop.pk',
    passwordHash: 'a-long-enough-password',
    role: STAFF_ROLE.BRANCH_MANAGER,
    branchId: dha2._id,
  })

  nustManager = await StaffUser.create({
    name: 'NUST Manager',
    email: 'nust@sugarloop.pk',
    passwordHash: 'a-long-enough-password',
    role: STAFF_ROLE.BRANCH_MANAGER,
    branchId: nust._id,
  })
}

const CUSTOMER_PHONE = '+923001234567'

/**
 * Places a real order through the real pricing path, then backdates it into the business
 * day under test.
 *
 * The backdating is the point: `createdAt` is stamped by Mongoose at the real wall-clock
 * moment, and the report groups by it. Without this the test would only pass on the day it
 * was written. Written through the driver rather than the model so the timestamps plugin
 * does not immediately overwrite it.
 */
async function placeOrder({ branchCode = 'DHA2', qty = 2, expectedTotal = 85_800 } = {}) {
  const order = await orderService.create(
    {
      fulfilment: 'pickup',
      branchCode,
      contact: { name: 'Ayesha Khan', phone: CUSTOMER_PHONE },
      items: [{ kind: 'product', productId: String(donut._id), qty }],
      expectedTotal,
    },
    { verifiedPhone: CUSTOMER_PHONE },
    { now: NOW }
  )

  await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: NOW } })

  return order
}

const ctx = (actor) => ({ actor, ip: '127.0.0.1' })

/** Walks an order to `completed` through every legal step, as the board would. */
async function completeOrder(order, actor) {
  for (const status of [
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.READY_FOR_PICKUP,
    ORDER_STATUS.COMPLETED,
  ]) {
    await staffOrderService.changeStatus(String(order._id), { status }, ctx(actor))
  }
}

// The two suites share one connection, so only the last one closes it.
test('the daily report', { skip, concurrency: false }, async (t) => {
  t.beforeEach(seedFixtures)

  await t.test('takings count completed orders only', async () => {
    const completed = await placeOrder()
    await completeOrder(completed, admin)

    // Placed but never worked — the kitchen may still refuse it, so it is not money.
    await placeOrder()

    const report = await reportService.daily({ date: BUSINESS_DATE }, admin)

    assert.equal(report.ordersPlaced, 2, 'both orders were placed today')
    assert.equal(report.takings.orders, 1, 'only one was handed over')
    assert.equal(report.takings.gross, 85_800)
    assert.equal(report.byStatus.completed, 1)
    assert.equal(report.byStatus.placed, 1)
  })

  await t.test('a failed order contributes nothing to takings, but is counted', async () => {
    const order = await placeOrder()
    await staffOrderService.changeStatus(
      String(order._id),
      { status: ORDER_STATUS.FAILED, reason: FAILURE_REASON.NO_ANSWER },
      ctx(admin)
    )

    const report = await reportService.daily({ date: BUSINESS_DATE }, admin)

    assert.equal(report.takings.gross, 0)
    assert.equal(report.takings.orders, 0)
    assert.equal(report.byStatus.failed, 1)
    assert.deepEqual(report.failures, [{ reason: FAILURE_REASON.NO_ANSWER, count: 1 }])
  })

  await t.test('a branch manager sees only their own branch', async () => {
    const dha2Order = await placeOrder({ branchCode: 'DHA2' })
    await completeOrder(dha2Order, admin)

    const nustOrder = await placeOrder({ branchCode: 'NUST' })
    await completeOrder(nustOrder, admin)

    const forDha2 = await reportService.daily({ date: BUSINESS_DATE }, dha2Manager)
    assert.equal(forDha2.takings.orders, 1)
    assert.equal(forDha2.branchId, String(dha2._id))

    const forNust = await reportService.daily({ date: BUSINESS_DATE }, nustManager)
    assert.equal(forNust.takings.orders, 1)

    // The admin sees both shops' takings added together.
    const forAdmin = await reportService.daily({ date: BUSINESS_DATE }, admin)
    assert.equal(forAdmin.takings.orders, 2)
    assert.equal(forAdmin.takings.gross, 171_600)
    assert.equal(forAdmin.branchId, null)
  })

  await t.test('a manager asking for another branch is refused, not re-scoped', async () => {
    await assert.rejects(
      () => reportService.daily({ date: BUSINESS_DATE, branchId: String(nust._id) }, dha2Manager),
      // Quietly returning their own branch's numbers instead would teach the console that
      // the filter works when it does not.
      (error) => error.statusCode === 403
    )
  })

  await t.test('an admin may narrow to one branch', async () => {
    const dha2Order = await placeOrder({ branchCode: 'DHA2' })
    await completeOrder(dha2Order, admin)
    await placeOrder({ branchCode: 'NUST' })

    const report = await reportService.daily(
      { date: BUSINESS_DATE, branchId: String(dha2._id) },
      admin
    )

    assert.equal(report.ordersPlaced, 1)
    assert.equal(report.takings.gross, 85_800)
  })

  await t.test('what sold is counted from completed orders', async () => {
    const order = await placeOrder({ qty: 2 })
    await completeOrder(order, admin)

    const report = await reportService.daily({ date: BUSINESS_DATE }, admin)

    assert.equal(report.topItems.length, 1)
    assert.equal(report.topItems[0].name, 'KitKat Crunch')
    assert.equal(report.topItems[0].qty, 2)
    assert.equal(report.topItems[0].revenue, 85_800)
  })

  await t.test('a day with no trading reports zeroes rather than failing', async () => {
    const report = await reportService.daily({ date: '2026-08-09' }, admin)

    assert.equal(report.ordersPlaced, 0)
    assert.equal(report.takings.gross, 0)
    assert.deepEqual(report.topItems, [])
    assert.deepEqual(report.failures, [])
    assert.equal(report.byStatus.completed, 0)
  })
})

/**
 * The running total.
 *
 * The rule worth proving is the one the daily report cannot answer: that takings ADD UP
 * across days rather than being replaced by the last one looked at.
 */
test('the running total', { skip, concurrency: false }, async (t) => {
  t.beforeEach(seedFixtures)
  t.after(() => disconnectTestDatabase(connected))

  /** Places an order on a given business day and walks it to completed. */
  async function completedOn(day, { branchCode = 'DHA2' } = {}) {
    const order = await placeOrder({ branchCode })
    await completeOrder(order, admin)
    await Order.collection.updateOne(
      { _id: order._id },
      { $set: { createdAt: new Date(`${day}T14:00:00+05:00`) } }
    )
    return order
  }

  await t.test('all time adds every day together', async () => {
    await completedOn('2026-08-10')
    await completedOn('2026-08-11')
    await completedOn('2026-08-12')

    // Each single day sees only its own order...
    const oneDay = await reportService.daily({ date: '2026-08-11' }, admin)
    assert.equal(oneDay.takings.orders, 1)
    assert.equal(oneDay.takings.gross, 85_800)

    // ...while the running total sees all three.
    const total = await reportService.summary({}, admin)
    assert.equal(total.takings.orders, 3)
    assert.equal(total.takings.gross, 257_400)
    assert.equal(total.from, null)
    assert.equal(total.to, null)
  })

  await t.test('all time reports the span it actually covered', async () => {
    await completedOn('2026-08-10')
    await completedOn('2026-08-12')

    const total = await reportService.summary({}, admin)

    assert.equal(total.firstOrderAt.toISOString(), new Date('2026-08-10T14:00:00+05:00').toISOString())
    assert.equal(total.lastOrderAt.toISOString(), new Date('2026-08-12T14:00:00+05:00').toISOString())
  })

  await t.test('a range includes both end days in full', async () => {
    await completedOn('2026-08-10')
    await completedOn('2026-08-11')
    await completedOn('2026-08-12')

    const ranged = await reportService.summary({ from: '2026-08-10', to: '2026-08-11' }, admin)

    assert.equal(ranged.takings.orders, 2, 'the 12th is outside the range')
    assert.equal(ranged.takings.gross, 171_600)
  })

  await t.test('an open-ended range runs to the end of the data', async () => {
    await completedOn('2026-08-10')
    await completedOn('2026-08-11')
    await completedOn('2026-08-12')

    const since = await reportService.summary({ from: '2026-08-11' }, admin)
    assert.equal(since.takings.orders, 2)

    const upTo = await reportService.summary({ to: '2026-08-11' }, admin)
    assert.equal(upTo.takings.orders, 2)
  })

  await t.test('a branch manager totals only their own branch', async () => {
    await completedOn('2026-08-10', { branchCode: 'DHA2' })
    await completedOn('2026-08-11', { branchCode: 'DHA2' })
    await completedOn('2026-08-11', { branchCode: 'NUST' })

    const forDha2 = await reportService.summary({}, dha2Manager)
    assert.equal(forDha2.takings.orders, 2)

    const forAdmin = await reportService.summary({}, admin)
    assert.equal(forAdmin.takings.orders, 3)
  })

  await t.test('a manager asking for another branch is refused', async () => {
    await assert.rejects(
      () => reportService.summary({ branchId: String(nust._id) }, dha2Manager),
      (error) => error.statusCode === 403
    )
  })

  await t.test('a shop that has never traded totals zero rather than failing', async () => {
    const total = await reportService.summary({}, admin)

    assert.equal(total.takings.gross, 0)
    assert.equal(total.ordersPlaced, 0)
    assert.equal(total.firstOrderAt, null)
    assert.deepEqual(total.topItems, [])
  })
})
