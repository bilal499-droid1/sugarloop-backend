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

  assert.equal(dha.isAcceptingOrdersAt(pkt('14:00'), 'delivery'), true)
  assert.equal(dha.isAcceptingOrdersAt(pkt('02:29'), 'delivery'), true)
  assert.equal(dha.isAcceptingOrdersAt(pkt('02:31'), 'delivery'), false, 'past the 02:30 cutoff')
  assert.equal(dha.isOpenAt(pkt('02:31')), true, 'trading, just not taking new deliveries')
  assert.equal(dha.isAcceptingOrdersAt(pkt('09:00'), 'delivery'), false)
})

test('only delivery stops early — collection runs until closing', () => {
  const dha = branch()

  assert.equal(dha.isAcceptingOrdersAt(pkt('02:45'), 'pickup'), true)
  assert.equal(dha.isAcceptingOrdersAt(pkt('03:00'), 'pickup'), false)
  assert.equal(dha.minutesUntilLastOrder(pkt('02:00'), 'delivery'), 30)
  assert.equal(dha.minutesUntilLastOrder(pkt('02:00'), 'pickup'), 60)

  // No mode named: can it take ANY order? Yes while collection is open…
  assert.equal(dha.isAcceptingOrdersAt(pkt('02:45')), true)
  // …but a delivery-only branch stops with its deliveries.
  const deliveryOnly = branch({ fulfilment: ['delivery'] })
  assert.equal(deliveryOnly.isAcceptingOrdersAt(pkt('02:45')), false)
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
  assert.equal(longBuffer.isAcceptingOrdersAt(pkt('01:29'), 'delivery'), true)
  assert.equal(longBuffer.isAcceptingOrdersAt(pkt('01:31'), 'delivery'), false)
})

test('nextOpeningAt is quoted back in the closed-hours rejection', () => {
  const dha = branch()

  assert.equal(dha.nextOpeningAt(pkt('04:00')).toISOString(), pkt('11:00').toISOString())
  assert.equal(dha.nextOpeningAt(pkt('02:31')).toISOString(), pkt('11:00').toISOString())
})

test('minutesUntilLastOrder feeds the checkout countdown', () => {
  const dha = branch()

  assert.equal(dha.minutesUntilLastOrder(pkt('02:00'), 'delivery'), 30)
  assert.equal(dha.minutesUntilLastOrder(pkt('02:30'), 'delivery'), null)
})

test('deliveryHours narrows delivery without closing the shop (DHA 2, 2026-09-18)', () => {
  const dha2 = branch({
    hours: { open: '10:00', close: '00:00' },
    deliveryHours: { open: '16:00', close: '00:00' },
    fulfilment: ['delivery', 'pickup'],
  })

  assert.equal(dha2.isOpenAt(pkt('11:29')), true)
  assert.equal(dha2.isAcceptingOrdersAt(pkt('11:29')), true, 'the picker reads open')
  assert.equal(dha2.isAcceptingOrdersAt(pkt('11:29'), 'pickup'), true)
  assert.equal(dha2.isAcceptingOrdersAt(pkt('11:29'), 'delivery'), false)
  assert.equal(dha2.startsLaterToday(pkt('11:29'), 'delivery'), true)
  assert.equal(
    dha2.nextOpeningAt(pkt('11:29'), 'delivery').toISOString(),
    pkt('16:00').toISOString()
  )

  assert.equal(dha2.isAcceptingOrdersAt(pkt('16:00'), 'delivery'), true)
  assert.equal(dha2.isAcceptingOrdersAt(pkt('23:29'), 'delivery'), true)
  assert.equal(dha2.isAcceptingOrdersAt(pkt('23:31'), 'delivery'), false, 'delivery buffer still applies')
  assert.equal(dha2.startsLaterToday(pkt('23:31'), 'delivery'), false, 'finished, not starting later')
  assert.equal(dha2.isAcceptingOrdersAt(pkt('23:59'), 'pickup'), true)
  assert.equal(dha2.isAcceptingOrdersAt(pkt('09:59')), false)

  assert.equal(dha2.minutesUntilLastOrder(pkt('11:00')), 13 * 60, 'counts down to the collection close')
})

test('without deliveryHours, delivery follows the trading hours', () => {
  const dha = branch()
  assert.deepEqual(dha.hoursFor('delivery'), { open: '11:00', close: '03:00' })
  assert.equal(dha.deliveryHours, undefined)
})
