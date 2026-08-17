import test from 'node:test'
import assert from 'node:assert/strict'

import {
  businessDateStamp,
  businessDayRange,
  isOpenAt,
  isAcceptingOrdersAt,
  minuteOfDayInZone,
  minutesUntilLastOrder,
  nextOpeningAt,
  parseTimeOfDay,
} from './time.js'

const KARACHI = 'Asia/Karachi'

/** Sugarloop's confirmed trading window: open 11:00, close 03:00, last order 02:30. */
const SUGARLOOP = { open: '11:00', close: '03:00', bufferMinutes: 30 }

/**
 * A UTC instant for a given Asia/Karachi wall clock.
 *
 * Written as an explicit -05:00 in the ISO string rather than by calling the module's own
 * conversion, so the tests cannot agree with a bug in the code they are testing. Pakistan
 * is UTC+5 year-round today; if that ever changes these fixtures are what will fail first,
 * which is the intent.
 */
const pkt = (dayOfMonth, hhmm) => new Date(`2026-08-${String(dayOfMonth).padStart(2, '0')}T${hhmm}:00+05:00`)

test('parseTimeOfDay converts and rejects', async (t) => {
  await t.test('parses a valid time', () => {
    assert.equal(parseTimeOfDay('00:00'), 0)
    assert.equal(parseTimeOfDay('11:00'), 660)
    assert.equal(parseTimeOfDay('02:30'), 150)
    assert.equal(parseTimeOfDay('23:59'), 1439)
  })

  await t.test('throws rather than returning NaN', () => {
    // A silent NaN here would make every comparison false and shut the shop permanently.
    for (const bad of ['24:00', '11:60', '1:00', '', 'lunchtime', null, undefined]) {
      assert.throws(() => parseTimeOfDay(bad), TypeError, `expected '${bad}' to throw`)
    }
  })
})

test('minuteOfDayInZone reads wall clock, not UTC', () => {
  // 21:00 UTC is 02:00 the next day in Karachi. Reading this as UTC would place it four
  // hours before the cutoff instead of half an hour after it.
  assert.equal(minuteOfDayInZone(new Date('2026-08-10T21:00:00Z'), KARACHI), 2 * 60)
  assert.equal(minuteOfDayInZone(new Date('2026-08-10T19:00:00Z'), KARACHI), 0)
  assert.equal(minuteOfDayInZone(new Date('2026-08-10T06:00:00Z'), KARACHI), 11 * 60)
})

/**
 * The eight times named in the kickoff brief's Step 4 acceptance check, plus the exact
 * boundary minutes — which is where an off-by-one lives.
 */
test('the trading window 11:00 - 03:00 wraps midnight correctly', async (t) => {
  const cases = [
    // time     open?   accepting?  why
    ['11:00', true, true, 'opens on the minute'],
    ['14:00', true, true, 'mid-afternoon'],
    ['23:59', true, true, 'last minute before midnight'],
    ['00:30', true, true, 'after midnight, still the same trading night'],
    ['02:29', true, true, 'one minute inside the cutoff'],
    ['02:31', true, false, 'trading, but past the last-order cutoff'],
    ['03:30', false, false, 'after close'],
    ['10:59', false, false, 'one minute before opening'],
  ]

  for (const [time, expectedOpen, expectedAccepting, why] of cases) {
    await t.test(`${time} — ${why}`, () => {
      const at = pkt(10, time)

      assert.equal(isOpenAt({ ...SUGARLOOP, at, bufferMinutes: 0 }), expectedOpen, 'isOpenAt')
      assert.equal(isAcceptingOrdersAt({ ...SUGARLOOP, at }), expectedAccepting, 'isAcceptingOrdersAt')
    })
  }
})

test('window boundaries are half-open', async (t) => {
  await t.test('03:00 exactly is shut — closing time is not another orderable minute', () => {
    assert.equal(isOpenAt({ ...SUGARLOOP, at: pkt(10, '03:00'), bufferMinutes: 0 }), false)
  })

  await t.test('02:30 exactly is past the cutoff', () => {
    assert.equal(isAcceptingOrdersAt({ ...SUGARLOOP, at: pkt(10, '02:30') }), false)
    // ...but the branch is still trading, which is what lets staff finish existing orders.
    assert.equal(isOpenAt({ ...SUGARLOOP, at: pkt(10, '02:30'), bufferMinutes: 0 }), true)
  })

  await t.test('11:00 exactly is open', () => {
    assert.equal(isAcceptingOrdersAt({ ...SUGARLOOP, at: pkt(10, '11:00') }), true)
  })
})

test('a non-wrapping window still behaves', async (t) => {
  // Nothing in the design uses one today, but the branch schema allows it and a future
  // daytime-only branch must not fall into the midnight-wrap path.
  const dayShift = { open: '09:00', close: '17:00', bufferMinutes: 30 }

  await t.test('inside', () => {
    assert.equal(isOpenAt({ ...dayShift, at: pkt(10, '12:00'), bufferMinutes: 0 }), true)
    assert.equal(isAcceptingOrdersAt({ ...dayShift, at: pkt(10, '16:29') }), true)
  })

  await t.test('outside', () => {
    assert.equal(isOpenAt({ ...dayShift, at: pkt(10, '08:59'), bufferMinutes: 0 }), false)
    assert.equal(isOpenAt({ ...dayShift, at: pkt(10, '17:00'), bufferMinutes: 0 }), false)
    assert.equal(isAcceptingOrdersAt({ ...dayShift, at: pkt(10, '16:31') }), false)
    // 01:00 is outside a 09:00-17:00 window, but inside a wrapping one. This is the
    // assertion that catches straighten() being applied unconditionally.
    assert.equal(isOpenAt({ ...dayShift, at: pkt(10, '01:00'), bufferMinutes: 0 }), false)
  })
})

test('a buffer at least as long as the window closes the shop', () => {
  // Guarded explicitly: without it the cutoff falls below the open time and the
  // comparison inverts, which would report a branch as open around the clock.
  assert.equal(
    isAcceptingOrdersAt({ open: '11:00', close: '13:00', bufferMinutes: 120, at: pkt(10, '12:00') }),
    false
  )
  assert.equal(
    isAcceptingOrdersAt({ open: '11:00', close: '13:00', bufferMinutes: 200, at: pkt(10, '12:00') }),
    false
  )
})

test('nextOpeningAt answers "when can I next order?"', async (t) => {
  await t.test('closed in the morning — later the same day', () => {
    assert.equal(nextOpeningAt({ open: '11:00', at: pkt(10, '04:00') }).toISOString(), pkt(10, '11:00').toISOString())
  })

  await t.test('one minute before opening', () => {
    assert.equal(nextOpeningAt({ open: '11:00', at: pkt(10, '10:59') }).toISOString(), pkt(10, '11:00').toISOString())
  })

  await t.test('past the cutoff but still trading — today at 11:00, not "already open"', () => {
    // 02:31 on the 10th belongs to the trading night that began on the 9th, so the next
    // time an order can be placed is 11:00 that same calendar morning.
    assert.equal(nextOpeningAt({ open: '11:00', at: pkt(10, '02:31') }).toISOString(), pkt(10, '11:00').toISOString())
  })

  await t.test('during service — tomorrow', () => {
    assert.equal(nextOpeningAt({ open: '11:00', at: pkt(10, '14:00') }).toISOString(), pkt(11, '11:00').toISOString())
  })

  await t.test('rolls over a month end', () => {
    assert.equal(
      nextOpeningAt({ open: '11:00', at: new Date('2026-08-31T18:00:00+05:00') }).toISOString(),
      new Date('2026-09-01T11:00:00+05:00').toISOString()
    )
  })

  await t.test('is always strictly in the future', () => {
    const at = pkt(10, '11:00')
    assert.ok(nextOpeningAt({ open: '11:00', at }).getTime() > at.getTime())
  })
})

test('minutesUntilLastOrder drives the checkout countdown', async (t) => {
  await t.test('counts down to 02:30', () => {
    assert.equal(minutesUntilLastOrder({ ...SUGARLOOP, at: pkt(10, '02:00') }), 30)
    assert.equal(minutesUntilLastOrder({ ...SUGARLOOP, at: pkt(10, '02:29') }), 1)
    assert.equal(minutesUntilLastOrder({ ...SUGARLOOP, at: pkt(10, '23:00') }), 210)
    // A full service: 11:00 to 02:30 is 15h30m.
    assert.equal(minutesUntilLastOrder({ ...SUGARLOOP, at: pkt(10, '11:00') }), 930)
  })

  await t.test('null once orders are no longer accepted', () => {
    assert.equal(minutesUntilLastOrder({ ...SUGARLOOP, at: pkt(10, '02:30') }), null)
    assert.equal(minutesUntilLastOrder({ ...SUGARLOOP, at: pkt(10, '02:31') }), null)
    assert.equal(minutesUntilLastOrder({ ...SUGARLOOP, at: pkt(10, '09:00') }), null)
  })
})

test('businessDateStamp is the date segment of an order number', async (t) => {
  await t.test('YYMMDD in Karachi', () => {
    assert.equal(businessDateStamp(pkt(10, '14:00')), '260810')
    assert.equal(businessDateStamp(pkt(9, '11:00')), '260809')
  })

  await t.test('pads single-digit months and days', () => {
    assert.equal(businessDateStamp(new Date('2026-01-05T14:00:00+05:00')), '260105')
  })

  await t.test('reads the Karachi calendar date, not UTC', () => {
    // 20:00 UTC is already 01:00 the NEXT day in Karachi. A server on UTC would stamp
    // the previous date and reuse a sequence number that day has already issued.
    assert.equal(businessDateStamp(new Date('2026-08-10T20:00:00Z'), KARACHI), '260811')
    assert.equal(businessDateStamp(new Date('2026-08-10T20:00:00Z'), 'UTC'), '260810')
  })

  await t.test('an after-midnight order takes the new calendar date', () => {
    // 01:00 on the 11th belongs to the trading night that opened on the 10th, but the
    // number carries the date on the customer's clock and on their receipt.
    assert.equal(businessDateStamp(pkt(11, '01:00')), '260811')
  })

  await t.test('rolls over year end', () => {
    assert.equal(businessDateStamp(new Date('2026-12-31T23:30:00+05:00')), '261231')
    assert.equal(businessDateStamp(new Date('2027-01-01T00:30:00+05:00')), '270101')
  })
})

test('businessDayRange bounds a local calendar date', async (t) => {
  await t.test('starts and ends at Karachi midnight, not UTC midnight', () => {
    const { start, end } = businessDayRange('2026-08-13')

    assert.equal(start.toISOString(), '2026-08-12T19:00:00.000Z')
    assert.equal(end.toISOString(), '2026-08-13T19:00:00.000Z')
  })

  await t.test('is half-open, so consecutive days neither overlap nor gap', () => {
    const { end } = businessDayRange('2026-08-13')
    const { start } = businessDayRange('2026-08-14')

    assert.equal(end.getTime(), start.getTime())
  })

  await t.test('an order at 23:59 Karachi lands in that day, not the next', () => {
    const { start, end } = businessDayRange('2026-08-13')
    const lateOrder = pkt(13, '23:59')

    assert.ok(lateOrder >= start && lateOrder < end)
  })

  await t.test('an order at 01:00 lands in the calendar day, matching the order number', () => {
    // Deliberately the same rule businessDateStamp uses: 01:00 on the 14th is numbered
    // 260814, so the board filtered to the 14th must show it. A trading-night grouping
    // would put it on the 13th and the two would disagree about the same order.
    const { start, end } = businessDayRange('2026-08-14')
    const afterMidnight = pkt(14, '01:00')

    assert.ok(afterMidnight >= start && afterMidnight < end)
    assert.equal(businessDateStamp(afterMidnight), '260814')
  })

  await t.test('rolls over month and year ends', () => {
    assert.equal(businessDayRange('2026-08-31').end.toISOString(), '2026-08-31T19:00:00.000Z')
    assert.equal(businessDayRange('2026-12-31').end.toISOString(), '2026-12-31T19:00:00.000Z')
  })

  await t.test('rejects anything that is not YYYY-MM-DD', () => {
    for (const bad of ['13-08-2026', '2026-8-13', 'today', '', '2026-08-13T00:00:00Z']) {
      assert.throws(() => businessDayRange(bad), TypeError, `should reject '${bad}'`)
    }
  })
})

test('the same instant is judged by Karachi time, not the server clock', () => {
  // A Render box runs UTC. At 22:00 UTC it is 03:00 in Karachi and the shop has shut —
  // a server reading its own clock would happily take the order.
  const instant = new Date('2026-08-10T22:00:00Z')

  assert.equal(isOpenAt({ ...SUGARLOOP, at: instant, bufferMinutes: 0, timeZone: KARACHI }), false)
  assert.equal(isOpenAt({ ...SUGARLOOP, at: instant, bufferMinutes: 0, timeZone: 'UTC' }), true)
})
