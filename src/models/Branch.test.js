import test from 'node:test'
import assert from 'node:assert/strict'

import { Branch } from './Branch.js'

/**
 * No database. Mongoose documents can be constructed and their methods called without a
 * connection, which is exactly what makes the branch-level switches cheap to test: the
 * hours arithmetic is already covered in `utils/time.test.js`, so what is under test here
 * is only what the document adds — `isActive`, `acceptingOrders`, and the delegation.
 */
const branch = (overrides = {}) =>
  new Branch({
    name: 'Sugarloop Test',
    code: 'TEST',
    address: 'Somewhere',
    city: 'Islamabad',
    phone: '+92 51 0000000',
    location: { type: 'Point', coordinates: [73.15, 33.53] },
    hours: { open: '11:00', close: '03:00' },
    lastOrderBufferMinutes: 30,
    ...overrides,
  })

const pkt = (hhmm) => new Date(`2026-08-10T${hhmm}:00+05:00`)

test('a trading branch follows the window', () => {
  const dha = branch()

  assert.equal(dha.isAcceptingOrdersAt(pkt('14:00')), true)
  assert.equal(dha.isAcceptingOrdersAt(pkt('02:29')), true)
  assert.equal(dha.isAcceptingOrdersAt(pkt('02:31')), false, 'past the 02:30 cutoff')
  assert.equal(dha.isOpenAt(pkt('02:31')), true, 'trading, just not taking new orders')
  assert.equal(dha.isAcceptingOrdersAt(pkt('09:00')), false)
})

test('acceptingOrders is the manager kill switch, independent of the clock', () => {
  const paused = branch({ acceptingOrders: false })

  // Mid-rush: the branch is open and staff are working, but the queue is closed.
  assert.equal(paused.isOpenAt(pkt('14:00')), true)
  assert.equal(paused.isAcceptingOrdersAt(pkt('14:00')), false)
  assert.equal(paused.minutesUntilLastOrder(pkt('14:00')), null)
})

test('an inactive branch is never open, at any hour', () => {
  const closed = branch({ isActive: false })

  assert.equal(closed.isOpenAt(pkt('14:00')), false)
  assert.equal(closed.isAcceptingOrdersAt(pkt('14:00')), false)
  assert.equal(closed.minutesUntilLastOrder(pkt('14:00')), null)
})

test('the buffer comes from the document, not a constant', () => {
  // Design §5: tunable per branch without a deploy. A branch with no buffer takes orders
  // until the moment it shuts.
  const noBuffer = branch({ lastOrderBufferMinutes: 0 })
  assert.equal(noBuffer.isAcceptingOrdersAt(pkt('02:59')), true)
  assert.equal(noBuffer.isAcceptingOrdersAt(pkt('03:00')), false)

  const longBuffer = branch({ lastOrderBufferMinutes: 90 })
  assert.equal(longBuffer.isAcceptingOrdersAt(pkt('01:29')), true)
  assert.equal(longBuffer.isAcceptingOrdersAt(pkt('01:31')), false)
})

test('nextOpeningAt is quoted back in the closed-hours rejection', () => {
  const dha = branch()

  assert.equal(dha.nextOpeningAt(pkt('04:00')).toISOString(), pkt('11:00').toISOString())
  assert.equal(dha.nextOpeningAt(pkt('02:31')).toISOString(), pkt('11:00').toISOString())
})

test('minutesUntilLastOrder feeds the checkout countdown', () => {
  const dha = branch()

  assert.equal(dha.minutesUntilLastOrder(pkt('02:00')), 30)
  assert.equal(dha.minutesUntilLastOrder(pkt('02:30')), null)
})
