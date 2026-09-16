import test from 'node:test'
import assert from 'node:assert/strict'

import { Order } from '../models/Order.js'
import { Branch } from '../models/Branch.js'
import { FAILURE_REASON, ORDER_STATUS } from '../config/constants.js'
import { expiryDeadline, expireOrder, expireStaleOrders } from './orderExpiry.service.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * The deadline arithmetic is pure and is tested without a database. Everything below it
 * is not: what this rule has to get right is a conditional write racing a manager's
 * click, which cannot be observed against a stub.
 *
 * The suite SKIPS rather than fails when Mongo is unreachable, matching the other
 * integration suites here.
 */

const HOURS = { open: '11:00', close: '03:00' }
const PKT = '+05:00'

test('expiryDeadline — the fuse, or closing time, whichever comes first', async (t) => {
  await t.test('mid-service it is the fuse', () => {
    const placedAt = new Date(`2026-09-16T20:00:00${PKT}`)

    const deadline = expiryDeadline({ placedAt, branch: { hours: HOURS }, minutes: 30 })

    assert.equal(deadline.toISOString(), new Date(`2026-09-16T20:30:00${PKT}`).toISOString())
  })

  await t.test('near closing the shop shuts first, and the fuse is cut short', () => {
    // 02:55 against an 03:00 close. The old fuse burned to 03:25, in a dark shop.
    const placedAt = new Date(`2026-09-17T02:55:00${PKT}`)

    const deadline = expiryDeadline({ placedAt, branch: { hours: HOURS }, minutes: 30 })

    assert.equal(deadline.toISOString(), new Date(`2026-09-17T03:00:00${PKT}`).toISOString())
  })

  await t.test('an order placed before midnight still closes at the NEXT 03:00', () => {
    const placedAt = new Date(`2026-09-16T23:50:00${PKT}`)

    const deadline = expiryDeadline({ placedAt, branch: { hours: HOURS }, minutes: 30 })

    // The fuse, not the close — 00:20 is nowhere near 03:00 the following morning.
    assert.equal(deadline.toISOString(), new Date(`2026-09-17T00:20:00${PKT}`).toISOString())
  })

  await t.test('a branch that never closes falls back to the fuse', () => {
    const placedAt = new Date(`2026-09-16T20:00:00${PKT}`)
    const allDay = { hours: { open: '00:00', close: '00:00' } }

    const deadline = expiryDeadline({ placedAt, branch: allDay, minutes: 30 })

    assert.equal(deadline.toISOString(), new Date(`2026-09-16T20:30:00${PKT}`).toISOString())
  })

  await t.test('an unpopulated branch is not a crash', () => {
    const placedAt = new Date(`2026-09-16T20:00:00${PKT}`)

    const deadline = expiryDeadline({ placedAt, branch: null, minutes: 30 })

    assert.equal(deadline.toISOString(), new Date(`2026-09-16T20:30:00${PKT}`).toISOString())
  })
})

const { connected, skip } = await connectTestDatabase('order-expiry')

let branch

/** Never the real mailer: the local .env points EMAIL_TRANSPORT at a live Gmail account. */
function mailbox() {
  const sent = []
  return { sent, send: async (message) => void sent.push(message) }
}

/** Notifications are already unit-tested; here they only need to not send. */
const notifications = { send: async () => ({ messageId: 'test' }) }

let sequence = 0

async function placeOrder({ minutesAgo, status = ORDER_STATUS.PLACED }) {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000)
  sequence += 1

  const [order] = await Order.create(
    [
      {
        orderNumber: `SL-TEST-${String(sequence).padStart(4, '0')}`,
        branchId: branch._id,
        branchCode: branch.code,
        fulfilment: 'pickup',
        contact: { name: 'Ayesha Khan', email: 'ayesha.khan@example.com' },
        items: [
          {
            kind: 'product',
            name: 'KitKat Crunch',
            unitPrice: 42_900,
            qty: 1,
            lineTotal: 42_900,
            netAmount: 42_900,
            grossAmount: 42_900,
          },
        ],
        totals: { subtotal: 42_900, grandTotal: 42_900 },
        // The lead time the customer was quoted: placedAt + 45 minutes.
        promisedAt: new Date(createdAt.getTime() + 45 * 60_000),
        status,
        statusHistory: [{ status, at: createdAt, by: 'system' }],
        createdAt,
      },
    ],
    // createdAt is set explicitly, so the timestamp plugin must not overwrite it.
    { timestamps: false }
  )

  return order
}

test('expiring unacknowledged orders', { skip }, async (t) => {
  t.before(async () => {
    branch = await Branch.create({
      name: 'Sugar Loop DHA 2',
      code: 'DHA2',
      address: 'Nadir Arcade',
      city: 'Islamabad',
      phone: '+92 370 4193372',
      location: { type: 'Point', coordinates: [73.1574172, 33.5312498] },
      // Round the clock, so a suite that runs at 4am is testing the fuse and not the
      // branch's opening hours.
      hours: { open: '00:00', close: '00:00' },
    })
  })

  t.beforeEach(async () => {
    await Order.deleteMany({})
  })

  t.after(async () => {
    if (connected) {
      await Order.deleteMany({})
      await Branch.deleteMany({})
    }
    await disconnectTestDatabase(connected)
  })

  await t.test('an order nobody confirmed is failed, with the system as the actor', async () => {
    const order = await placeOrder({ minutesAgo: 45 })
    const mail = mailbox()

    const result = await expireStaleOrders({ notifications, email: mail.send })

    assert.equal(result.expired, 1)

    const after = await Order.findById(order._id)
    assert.equal(after.status, ORDER_STATUS.FAILED)
    assert.equal(after.failureReason, FAILURE_REASON.NOT_ACKNOWLEDGED)

    const last = after.statusHistory.at(-1)
    assert.equal(last.status, ORDER_STATUS.FAILED)
    assert.equal(last.by, 'system')
    assert.equal(last.reason, FAILURE_REASON.NOT_ACKNOWLEDGED)
  })

  await t.test('the customer is told, by email, and told they owe nothing', async () => {
    await placeOrder({ minutesAgo: 45 })
    const mail = mailbox()

    await expireStaleOrders({ notifications, email: mail.send })

    assert.equal(mail.sent.length, 1)
    assert.equal(mail.sent[0].to, 'ayesha.khan@example.com')
    assert.match(mail.sent[0].text, /not been charged/)
    // The number to ring is the branch's, which is the whole point of sending this.
    assert.match(mail.sent[0].text, /\+92 370 4193372/)
  })

  await t.test('an order still inside its fuse is left alone', async () => {
    const order = await placeOrder({ minutesAgo: 5 })
    const mail = mailbox()

    const result = await expireStaleOrders({ notifications, email: mail.send })

    assert.equal(result.expired, 0)
    assert.equal(mail.sent.length, 0)
    assert.equal((await Order.findById(order._id)).status, ORDER_STATUS.PLACED)
  })

  await t.test('an order somebody confirmed is never expired, however old', async () => {
    const order = await placeOrder({ minutesAgo: 600, status: ORDER_STATUS.CONFIRMED })
    const mail = mailbox()

    const result = await expireStaleOrders({ notifications, email: mail.send })

    assert.equal(result.expired, 0)
    assert.equal((await Order.findById(order._id)).status, ORDER_STATUS.CONFIRMED)
  })

  await t.test('a manager confirming first wins the race, and nothing is sent', async () => {
    const order = await placeOrder({ minutesAgo: 45 })
    const mail = mailbox()

    // The click that lands between the sweep reading the row and writing to it.
    await Order.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.CONFIRMED } })

    const result = await expireOrder(order, { notifications, email: mail.send })

    assert.equal(result, null)
    assert.equal(mail.sent.length, 0)

    const after = await Order.findById(order._id)
    assert.equal(after.status, ORDER_STATUS.CONFIRMED)
    assert.equal(after.failureReason, null)
  })

  await t.test('a second sweep over the same order does nothing twice', async () => {
    await placeOrder({ minutesAgo: 45 })
    const mail = mailbox()

    await expireStaleOrders({ notifications, email: mail.send })
    const second = await expireStaleOrders({ notifications, email: mail.send })

    assert.equal(second.expired, 0)
    assert.equal(mail.sent.length, 1)
  })
})
