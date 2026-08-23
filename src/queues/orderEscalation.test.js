import test from 'node:test'
import assert from 'node:assert/strict'

import { Order } from '../models/Order.js'
import { Branch } from '../models/Branch.js'
import { ORDER_STATUS, FULFILMENT, PAYMENT_METHOD, PAYMENT_STATUS } from '../config/constants.js'
import { ESCALATION_LEVELS, processEscalation } from './orderEscalation.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * The unacknowledged-order escalation.
 *
 * `processEscalation` is exported and tested directly rather than through BullMQ: the
 * scheduling is the library's job and well covered by its own suite, while the decision
 * of whether to chase is ours and is where the damage would be.
 *
 * The rule carrying the most weight is the status re-check. Chasing a manager about an
 * order they confirmed ten minutes ago is worse than missing one — it teaches everybody
 * to ignore the alert, and then the alert protects nothing.
 *
 * SKIPS rather than fails when Mongo is unreachable, matching the other integration
 * suites. See testing/mongoTestDb.js.
 */
const { connected, skip } = await connectTestDatabase('orderEscalation')

/** A send that records what it was asked to deliver. */
function recorder() {
  const sent = []
  return {
    sent,
    notify: async (message) => {
      sent.push(message)
    },
  }
}

async function makeBranch(overrides = {}) {
  return Branch.create({
    code: 'DHA2',
    name: 'Sugar Loop DHA 2',
    address: '1st Floor, Nadir Arcade, Sector E, DHA Phase II, Islamabad',
    city: 'Islamabad',
    phone: '+92 51 111 557 799',
    location: { type: 'Point', coordinates: [73.1574172, 33.5312498] },
    hours: { open: '11:00', close: '03:00' },
    deliveryRadiusKm: 2,
    lastOrderBufferMinutes: 30,
    fulfilment: ['delivery', 'pickup'],
    ...overrides,
  })
}

async function makeOrder(branch, status = ORDER_STATUS.PLACED) {
  return Order.create({
    orderNumber: `SL-260824-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    contact: { name: 'Ayesha', phone: '+923001234567' },
    branchId: branch._id,
    branchCode: branch.code,
    fulfilment: FULFILMENT.PICKUP,
    items: [
      {
        kind: 'product',
        name: 'Chocoholic',
        unitPrice: 29900,
        qty: 1,
        lineTotal: 29900,
        netAmount: 29900,
        taxRate: 0,
        taxAmount: 0,
        grossAmount: 29900,
      },
    ],
    totals: {
      subtotal: 29900,
      deliveryFee: 0,
      discount: 0,
      taxTotal: 0,
      grandTotal: 29900,
    },
    payment: { method: PAYMENT_METHOD.COD, status: PAYMENT_STATUS.PENDING, provider: null },
    status,
    statusHistory: [{ status: ORDER_STATUS.PLACED, at: new Date(), by: 'system' }],
    promisedAt: new Date(Date.now() + 45 * 60_000),
    meta: { ip: '', userAgent: '', source: 'web' },
  })
}

test('order escalation', { skip, concurrency: false }, async (t) => {
  t.after(() => disconnectTestDatabase(connected))
  t.beforeEach(async () => {
    await Order.deleteMany({})
    await Branch.deleteMany({})
  })

  await t.test('chases the branch about an order still sitting in placed', async () => {
    const branch = await makeBranch()
    const order = await makeOrder(branch)
    const { sent, notify } = recorder()

    const result = await processEscalation(
      { orderId: String(order._id), level: ESCALATION_LEVELS.MANAGER, waitedMinutes: 5 },
      { notify }
    )

    assert.equal(result.sent, true)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, '+92 51 111 557 799', 'the branch line, where the order is made')
    assert.equal(sent[0].waitedMinutes, 5)
    assert.equal(sent[0].order.orderNumber, order.orderNumber)
  })

  await t.test('says nothing about an order that has been acknowledged', async () => {
    // The rule that matters most. Confirming IS the acknowledgement, and a job that
    // fires a second later must not chase anybody.
    const branch = await makeBranch()
    const order = await makeOrder(branch, ORDER_STATUS.CONFIRMED)
    const { sent, notify } = recorder()

    const result = await processEscalation(
      { orderId: String(order._id), level: ESCALATION_LEVELS.MANAGER, waitedMinutes: 5 },
      { notify }
    )

    assert.equal(result.sent, false)
    assert.equal(result.reason, 'already-acknowledged')
    assert.equal(sent.length, 0)
  })

  for (const status of [
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.READY_FOR_PICKUP,
    ORDER_STATUS.COMPLETED,
    ORDER_STATUS.FAILED,
  ]) {
    await t.test(`${status} is not chased either`, async () => {
      const branch = await makeBranch()
      const order = await makeOrder(branch, status)
      const { sent, notify } = recorder()

      await processEscalation(
        { orderId: String(order._id), level: ESCALATION_LEVELS.ADMIN, waitedMinutes: 10 },
        { notify }
      )

      assert.equal(sent.length, 0, 'only `placed` means nobody has looked at it')
    })
  }

  await t.test('a deleted order is not an error', async () => {
    const { sent, notify } = recorder()

    const result = await processEscalation(
      {
        orderId: '0123456789abcdef01234567',
        level: ESCALATION_LEVELS.MANAGER,
        waitedMinutes: 5,
      },
      { notify }
    )

    assert.equal(result.sent, false)
    assert.equal(result.reason, 'order-not-found')
    assert.equal(sent.length, 0)
  })

  await t.test('a branch cannot exist without a phone to chase', async () => {
    // The manager rung has nowhere else to send to, so the protection is upstream: the
    // model refuses the branch rather than the queue discovering it at 2am. Asserted
    // here because this queue is what depends on it.
    await assert.rejects(() => makeBranch({ phone: '' }), /phone/i)
  })

  await t.test('the admin rung does not go to the branch that ignored it', async () => {
    // The whole point of a second rung: ringing the same unattended phone again is not
    // an escalation.
    const branch = await makeBranch()
    const order = await makeOrder(branch)
    const { sent, notify } = recorder()

    await processEscalation(
      { orderId: String(order._id), level: ESCALATION_LEVELS.ADMIN, waitedMinutes: 10 },
      { notify }
    )

    // ADMIN_ESCALATION_PHONE and ENQUIRY_NOTIFY_PHONE are both unset in test, so this
    // resolves to no recipient — but crucially NOT to the branch's number.
    assert.equal(sent.length, 0)
  })
})
