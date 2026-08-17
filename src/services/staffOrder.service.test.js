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
import {
  FAILURE_REASON,
  ORDER_STATUS,
  PAYMENT_STATUS,
  STAFF_ROLE,
} from '../config/constants.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Integration tests. What they check — branch scoping across two real branches, the
 * conditional write that settles a race between two managers, and the audit rows a
 * transition leaves behind — is all database behaviour. The pure state-machine rules are
 * covered without Mongo in orderStatus.test.js.
 *
 * SKIPS rather than fails when Mongo is unreachable, matching order.service.test.js.
 */
const { connected, skip } = await connectTestDatabase('staffOrder')

/** Mid-service, so the branch is open and orders can be placed. */
const NOW = new Date('2026-08-10T14:00:00+05:00')

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

/** Places a real order through the real pricing path, so the fixture is never a fiction. */
function placeOrder({ branchCode = 'DHA2', fulfilment = 'pickup', now = NOW } = {}) {
  return orderService.create(
    {
      fulfilment,
      branchCode,
      contact: { name: 'Ayesha Khan', phone: '+923001234567' },
      items: [{ kind: 'product', productId: String(donut._id), qty: 2 }],
      expectedTotal: 85_800,
    },
    {},
    { now }
  )
}

const ctx = (actor) => ({ actor, ip: '127.0.0.1' })

/** Walks an order forward through the happy path to `status`. */
async function advanceTo(order, status, actor) {
  const path = [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.COMPLETED]

  let current = order
  for (const step of path) {
    current = await staffOrderService.changeStatus(current._id, { status: step }, ctx(actor))
    if (step === status) return current
  }
  return current
}

test('staff order board', { skip, concurrency: false }, async (t) => {
  t.beforeEach(seedFixtures)
  t.after(() => disconnectTestDatabase(connected))

  await t.test('a transition appends to statusHistory with the actor', async () => {
    const order = await placeOrder()

    const moved = await staffOrderService.changeStatus(
      order._id,
      { status: ORDER_STATUS.CONFIRMED },
      ctx(dha2Manager)
    )

    assert.equal(moved.status, ORDER_STATUS.CONFIRMED)
    assert.equal(moved.statusHistory.length, 2, 'the placed event plus this one')

    const [placed, confirmed] = moved.statusHistory
    assert.equal(placed.status, ORDER_STATUS.PLACED)
    assert.equal(placed.by, 'system')
    assert.equal(confirmed.status, ORDER_STATUS.CONFIRMED)
    assert.equal(String(confirmed.by), String(dha2Manager._id))
  })

  await t.test('every transition is audited', async () => {
    const order = await placeOrder()

    await staffOrderService.changeStatus(
      order._id,
      { status: ORDER_STATUS.CONFIRMED, note: 'Rang the customer to confirm' },
      ctx(dha2Manager)
    )

    const entries = await AuditLog.find({ entity: 'Order', entityId: order._id })

    assert.equal(entries.length, 1)
    assert.equal(entries[0].action, 'order.status.change')
    assert.equal(String(entries[0].actorId), String(dha2Manager._id))
    // The order number, because that is what a human searching this trail has in hand.
    assert.equal(entries[0].changes.orderNumber, order.orderNumber)
    assert.deepEqual(entries[0].changes.status, { from: 'placed', to: 'confirmed' })
  })

  await t.test('completing a COD order collects the cash', async () => {
    const order = await placeOrder()
    assert.equal(order.payment.status, PAYMENT_STATUS.PENDING)

    const completed = await advanceTo(order, ORDER_STATUS.COMPLETED, dha2Manager)

    // Otherwise every completed order reads `pending` forever and no day's takings can
    // be computed from the order book.
    assert.equal(completed.status, ORDER_STATUS.COMPLETED)
    assert.equal(completed.payment.status, PAYMENT_STATUS.COLLECTED)
  })

  await t.test('failing records the reason on the order, terminally', async () => {
    const order = await placeOrder()

    const failed = await staffOrderService.changeStatus(
      order._id,
      { status: ORDER_STATUS.FAILED, reason: FAILURE_REASON.NO_ANSWER },
      ctx(dha2Manager)
    )

    assert.equal(failed.status, ORDER_STATUS.FAILED)
    assert.equal(failed.failureReason, FAILURE_REASON.NO_ANSWER)
    assert.equal(failed.statusHistory.at(-1).reason, FAILURE_REASON.NO_ANSWER)

    await assert.rejects(
      () =>
        staffOrderService.changeStatus(
          order._id,
          { status: ORDER_STATUS.CONFIRMED },
          ctx(dha2Manager)
        ),
      (err) => err.statusCode === 409
    )

    const reread = await Order.findById(order._id)
    assert.equal(reread.status, ORDER_STATUS.FAILED, 'nothing moved')
  })

  await t.test('a transition without a reason is rejected and writes nothing', async () => {
    const order = await placeOrder()

    await assert.rejects(
      () =>
        staffOrderService.changeStatus(order._id, { status: ORDER_STATUS.FAILED }, ctx(dha2Manager)),
      (err) => err.statusCode === 422
    )

    const reread = await Order.findById(order._id)
    assert.equal(reread.status, ORDER_STATUS.PLACED)
    assert.equal(reread.statusHistory.length, 1)
    assert.equal(await AuditLog.countDocuments({ entity: 'Order' }), 0)
  })

  await t.test('two managers racing the same transition: one wins, one is told', async () => {
    const order = await placeOrder()

    // Both read the board showing `placed`, both click Confirm. Without the conditional
    // write both would append a `confirmed` event to the same order.
    const results = await Promise.allSettled([
      staffOrderService.changeStatus(order._id, { status: ORDER_STATUS.CONFIRMED }, ctx(dha2Manager)),
      staffOrderService.changeStatus(order._id, { status: ORDER_STATUS.CONFIRMED }, ctx(admin)),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    assert.equal(fulfilled.length, 1, 'exactly one write lands')
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].reason.statusCode, 409)

    const reread = await Order.findById(order._id)
    assert.equal(reread.statusHistory.length, 2, 'one placed event, one confirmed event')
  })

  await t.test('a pickup order is never sent out for delivery', async () => {
    const order = await placeOrder({ fulfilment: 'pickup' })
    const preparing = await advanceTo(order, ORDER_STATUS.PREPARING, dha2Manager)

    await assert.rejects(
      () =>
        staffOrderService.changeStatus(
          preparing._id,
          { status: ORDER_STATUS.OUT_FOR_DELIVERY },
          ctx(dha2Manager)
        ),
      (err) => err.statusCode === 409 && err.details.allowed.includes(ORDER_STATUS.READY_FOR_PICKUP)
    )
  })

  await t.test('transitionsFor tells the board which buttons to draw', async () => {
    const order = await placeOrder()

    assert.deepEqual(staffOrderService.transitionsFor(order), {
      allowed: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.FAILED],
      isTerminal: false,
    })

    const failed = await staffOrderService.changeStatus(
      order._id,
      { status: ORDER_STATUS.FAILED, reason: FAILURE_REASON.BRANCH_UNABLE },
      ctx(dha2Manager)
    )

    assert.deepEqual(staffOrderService.transitionsFor(failed), { allowed: [], isTerminal: true })
  })

  await t.test('a branch manager cannot read another branch, even naming it', async () => {
    await placeOrder({ branchCode: 'DHA2' })
    await placeOrder({ branchCode: 'NUST' })

    // The step 7 acceptance check, now that there are orders to prove it against.
    const own = await staffOrderService.list({ limit: 50 }, dha2Manager)
    assert.equal(own.items.length, 1)
    assert.equal(own.items[0].branchCode, 'DHA2')

    await assert.rejects(
      () => staffOrderService.list({ branchId: String(nust._id), limit: 50 }, dha2Manager),
      (err) => err.statusCode === 403
    )

    // And asking for their own branch explicitly is fine.
    const explicit = await staffOrderService.list(
      { branchId: String(dha2._id), limit: 50 },
      dha2Manager
    )
    assert.equal(explicit.items.length, 1)
  })

  await t.test('an admin sees every branch, and may narrow to one', async () => {
    await placeOrder({ branchCode: 'DHA2' })
    await placeOrder({ branchCode: 'NUST' })

    const all = await staffOrderService.list({ limit: 50 }, admin)
    assert.equal(all.items.length, 2)

    const narrowed = await staffOrderService.list({ branchId: String(nust._id), limit: 50 }, admin)
    assert.equal(narrowed.items.length, 1)
    assert.equal(narrowed.items[0].branchCode, 'NUST')
  })

  await t.test("another branch's order is 404, not 403", async () => {
    const order = await placeOrder({ branchCode: 'NUST' })

    // The board has no reason to confirm that an id it may not read exists.
    await assert.rejects(
      () => staffOrderService.getById(order._id, dha2Manager),
      (err) => err.statusCode === 404
    )

    await assert.rejects(
      () =>
        staffOrderService.changeStatus(
          order._id,
          { status: ORDER_STATUS.CONFIRMED },
          ctx(dha2Manager)
        ),
      (err) => err.statusCode === 404
    )

    // The manager it does belong to reads it fine.
    await assert.doesNotReject(() => staffOrderService.getById(order._id, nustManager))
  })

  await t.test('filters by status, fulfilment, phone and date', async () => {
    const first = await placeOrder()
    await placeOrder()
    await staffOrderService.changeStatus(
      first._id,
      { status: ORDER_STATUS.CONFIRMED },
      ctx(dha2Manager)
    )

    const confirmed = await staffOrderService.list(
      { status: ORDER_STATUS.CONFIRMED, limit: 50 },
      admin
    )
    assert.equal(confirmed.items.length, 1)
    assert.equal(String(confirmed.items[0]._id), String(first._id))

    const pickups = await staffOrderService.list({ fulfilment: 'pickup', limit: 50 }, admin)
    assert.equal(pickups.items.length, 2)

    const byPhone = await staffOrderService.list({ phone: '+923001234567', limit: 50 }, admin)
    assert.equal(byPhone.items.length, 2)

    const wrongPhone = await staffOrderService.list({ phone: '+923009999999', limit: 50 }, admin)
    assert.equal(wrongPhone.items.length, 0)

    // The orders were created just now, so today's board finds them and a past date
    // does not. Written against the real clock because createdAt is set by Mongoose.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
    assert.equal((await staffOrderService.list({ date: today, limit: 50 }, admin)).items.length, 2)
    assert.equal(
      (await staffOrderService.list({ date: '2020-01-01', limit: 50 }, admin)).items.length,
      0
    )
  })

  await t.test('paginates by cursor', async () => {
    for (let i = 0; i < 3; i += 1) await placeOrder()

    const page1 = await staffOrderService.list({ limit: 2 }, admin)
    assert.equal(page1.items.length, 2)
    assert.ok(page1.nextCursor)

    const page2 = await staffOrderService.list({ limit: 2, cursor: page1.nextCursor }, admin)
    assert.equal(page2.items.length, 1)
    assert.equal(page2.nextCursor, null)

    const ids = [...page1.items, ...page2.items].map((order) => String(order._id))
    assert.equal(new Set(ids).size, 3, 'no row appears on two pages')
  })
})
