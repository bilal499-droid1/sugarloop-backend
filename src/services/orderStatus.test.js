import test from 'node:test'
import assert from 'node:assert/strict'

import { allowedTransitions, assertTransition, isTerminal } from './orderStatus.js'
import { FAILURE_REASON, FULFILMENT, ORDER_STATUS } from '../config/constants.js'

/**
 * Pure unit tests — no database, no HTTP. The state machine is the one piece of step 8
 * that decides whether a rider is sent to an address, so it is exercised at every edge of
 * the diagram rather than sampled through an integration test that needs Mongo running.
 */

const delivery = (status) => ({ status, fulfilment: FULFILMENT.DELIVERY })
const pickup = (status) => ({ status, fulfilment: FULFILMENT.PICKUP })

/** Asserts a call throws an ApiError with the expected status code. */
function throwsWith(statusCode, fn) {
  assert.throws(fn, (err) => {
    assert.equal(err.statusCode, statusCode, `expected ${statusCode}, got ${err.statusCode}`)
    return true
  })
}

test('the happy path advances one step at a time', () => {
  assert.deepEqual(allowedTransitions(delivery(ORDER_STATUS.PLACED)), [
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.FAILED,
  ])

  assert.deepEqual(allowedTransitions(delivery(ORDER_STATUS.CONFIRMED)), [
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.FAILED,
  ])
})

test('skipping ahead is refused', () => {
  throwsWith(409, () => assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.PREPARING))
  throwsWith(409, () => assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.COMPLETED))
})

test('going backwards is refused — statusHistory is a record, not a form', () => {
  throwsWith(409, () => assertTransition(delivery(ORDER_STATUS.PREPARING), ORDER_STATUS.CONFIRMED))
  throwsWith(409, () => assertTransition(delivery(ORDER_STATUS.CONFIRMED), ORDER_STATUS.PLACED))
})

test('re-sending the current status is a conflict, not a silent no-op', () => {
  throwsWith(409, () => assertTransition(delivery(ORDER_STATUS.PREPARING), ORDER_STATUS.PREPARING))
})

test('the handover step follows the fulfilment', async (t) => {
  await t.test('a delivery order goes out for delivery, never ready for pickup', () => {
    assert.deepEqual(allowedTransitions(delivery(ORDER_STATUS.PREPARING)), [
      ORDER_STATUS.OUT_FOR_DELIVERY,
      ORDER_STATUS.FAILED,
    ])

    throwsWith(409, () =>
      assertTransition(delivery(ORDER_STATUS.PREPARING), ORDER_STATUS.READY_FOR_PICKUP)
    )
  })

  await t.test('a pickup order is never sent out with a rider', () => {
    assert.deepEqual(allowedTransitions(pickup(ORDER_STATUS.PREPARING)), [
      ORDER_STATUS.READY_FOR_PICKUP,
      ORDER_STATUS.FAILED,
    ])

    // The bug this exists to stop: a rider dispatched to an order that carries no
    // address at all, because the board offered a button the state machine allows for
    // the other half of the orders on it.
    throwsWith(409, () =>
      assertTransition(pickup(ORDER_STATUS.PREPARING), ORDER_STATUS.OUT_FOR_DELIVERY)
    )
  })

  await t.test('both hand-over states complete', () => {
    assert.doesNotThrow(() =>
      assertTransition(delivery(ORDER_STATUS.OUT_FOR_DELIVERY), ORDER_STATUS.COMPLETED)
    )
    assert.doesNotThrow(() =>
      assertTransition(pickup(ORDER_STATUS.READY_FOR_PICKUP), ORDER_STATUS.COMPLETED)
    )
  })
})

test('failed is reachable from every non-terminal state', () => {
  for (const status of [
    ORDER_STATUS.PLACED,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.OUT_FOR_DELIVERY,
  ]) {
    assert.ok(
      allowedTransitions(delivery(status)).includes(ORDER_STATUS.FAILED),
      `${status} should be failable`
    )
  }

  assert.ok(allowedTransitions(pickup(ORDER_STATUS.READY_FOR_PICKUP)).includes(ORDER_STATUS.FAILED))
})

test('terminal states are terminal', async (t) => {
  await t.test('nothing leaves completed or failed', () => {
    assert.ok(isTerminal(ORDER_STATUS.COMPLETED))
    assert.ok(isTerminal(ORDER_STATUS.FAILED))

    assert.deepEqual(allowedTransitions(delivery(ORDER_STATUS.COMPLETED)), [])
    assert.deepEqual(allowedTransitions(delivery(ORDER_STATUS.FAILED)), [])
  })

  await t.test('a failed order cannot be revived, not even to failed again', () => {
    throwsWith(409, () =>
      assertTransition(delivery(ORDER_STATUS.FAILED), ORDER_STATUS.COMPLETED, {
        reason: FAILURE_REASON.NO_ANSWER,
      })
    )
    throwsWith(409, () =>
      assertTransition(delivery(ORDER_STATUS.FAILED), ORDER_STATUS.FAILED, {
        reason: FAILURE_REASON.NO_ANSWER,
      })
    )
  })

  await t.test('a completed order cannot then be failed', () => {
    throwsWith(409, () =>
      assertTransition(delivery(ORDER_STATUS.COMPLETED), ORDER_STATUS.FAILED, {
        reason: FAILURE_REASON.CUSTOMER_REQUEST,
      })
    )
  })
})

test('failing requires a reason', async (t) => {
  await t.test('no reason is rejected', () => {
    throwsWith(422, () => assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.FAILED))
    throwsWith(422, () =>
      assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.FAILED, { note: 'no idea' })
    )
  })

  await t.test('a reason from the list is accepted', () => {
    for (const reason of Object.values(FAILURE_REASON)) {
      // 'other' has its own rule, covered below.
      if (reason === FAILURE_REASON.OTHER) continue

      assert.doesNotThrow(() =>
        assertTransition(delivery(ORDER_STATUS.OUT_FOR_DELIVERY), ORDER_STATUS.FAILED, { reason })
      )
    }
  })

  await t.test("'other' needs a note, or it is just a missing reason code", () => {
    throwsWith(422, () =>
      assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.FAILED, {
        reason: FAILURE_REASON.OTHER,
      })
    )

    assert.doesNotThrow(() =>
      assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.FAILED, {
        reason: FAILURE_REASON.OTHER,
        note: 'Power cut across the sector, kitchen down for the night',
      })
    )
  })

  await t.test('a reason on a non-failure is rejected rather than quietly dropped', () => {
    // It means the dashboard sent the wrong body, and a stored `confirmed` event
    // carrying `reason: no_answer` would poison the count this field exists to produce.
    throwsWith(422, () =>
      assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.CONFIRMED, {
        reason: FAILURE_REASON.NO_ANSWER,
      })
    )
  })
})

test('a note is always optional on a legal transition', () => {
  assert.doesNotThrow(() =>
    assertTransition(delivery(ORDER_STATUS.PLACED), ORDER_STATUS.CONFIRMED, {
      note: 'Customer called to add a note for the rider',
    })
  )
})
