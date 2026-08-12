import test from 'node:test'
import assert from 'node:assert/strict'

import { Branch } from '../models/Branch.js'
import { branchView, branchListView } from './branchView.js'

const branch = (overrides = {}) =>
  new Branch({
    name: 'Sugarloop DHA Phase 2',
    code: 'DHA2',
    address: 'Somewhere in DHA',
    city: 'Islamabad',
    phone: '+92 51 0000002',
    // GeoJSON order: [longitude, latitude]. Deliberately distinct values so a swap fails.
    location: { type: 'Point', coordinates: [73.17, 33.52] },
    hours: { open: '11:00', close: '03:00' },
    lastOrderBufferMinutes: 30,
    ...overrides,
  })

const pkt = (hhmm) => new Date(`2026-08-10T${hhmm}:00+05:00`)

test('coordinates are published as named keys, not a bare array', () => {
  // [lng, lat] is backwards from every map UI and is how orders end up being dispatched
  // from the Arabian Sea. Named keys make the mistake unavailable to the client.
  const view = branchView(branch(), { at: pkt('14:00') })

  assert.deepEqual(view.location, { lat: 33.52, lng: 73.17 })
  assert.equal(Array.isArray(view.location), false)
})

test('the open/closed verdict is computed server-side', async (t) => {
  await t.test('mid-service', () => {
    const view = branchView(branch(), { at: pkt('14:00') })

    assert.equal(view.isOpenNow, true)
    assert.equal(view.isAcceptingOrders, true)
    assert.equal(view.minutesUntilLastOrder, 750)
  })

  await t.test('past the cutoff but still trading', () => {
    const view = branchView(branch(), { at: pkt('02:31') })

    // The distinction the checkout button depends on: staff are still working existing
    // orders, but the kitchen has stopped accepting new ones.
    assert.equal(view.isOpenNow, true)
    assert.equal(view.isAcceptingOrders, false)
    assert.equal(view.minutesUntilLastOrder, null)
  })

  await t.test('shut', () => {
    const view = branchView(branch(), { at: pkt('09:00') })

    assert.equal(view.isOpenNow, false)
    assert.equal(view.isAcceptingOrders, false)
    assert.equal(view.nextOpeningAt.toISOString(), pkt('11:00').toISOString())
  })

  await t.test('paused by the manager mid-rush', () => {
    const view = branchView(branch({ acceptingOrders: false }), { at: pkt('14:00') })

    assert.equal(view.isOpenNow, true)
    assert.equal(view.isAcceptingOrders, false)
  })
})

test('hours are published alongside the verdict, not instead of it', () => {
  const view = branchView(branch(), { at: pkt('14:00') })

  assert.deepEqual(view.hours, { open: '11:00', close: '03:00' })
  // Both present: the client displays the hours and obeys the flag, rather than
  // recomputing the verdict against a browser clock in the wrong timezone.
  assert.equal(typeof view.isAcceptingOrders, 'boolean')
})

test('branchListView judges every branch against one clock', () => {
  // Two branches evaluated milliseconds apart can disagree across 02:30:00 exactly,
  // which is a visible contradiction in a single response.
  const at = pkt('02:29')
  const views = branchListView([branch(), branch({ code: 'DHA5' })], { at })

  assert.equal(views.length, 2)
  assert.deepEqual(
    views.map((view) => view.isAcceptingOrders),
    [true, true]
  )
  assert.equal(views[0].minutesUntilLastOrder, views[1].minutesUntilLastOrder)
})

test('does not publish internal flags', () => {
  const view = branchView(branch(), { at: pkt('14:00') })

  for (const field of ['isActive', 'acceptingOrders', '_id', '__v', 'createdAt', 'updatedAt']) {
    assert.equal(view[field], undefined, `${field} should not be published`)
  }
  // `lastOrderBufferMinutes` is an operational knob; the client gets the countdown it
  // produces, not the knob itself.
  assert.equal(view.lastOrderBufferMinutes, undefined)
})
