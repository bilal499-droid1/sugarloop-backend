/**
 * Opening-hours arithmetic, in `Asia/Karachi`.
 *
 * Pure and dependency-free by design: these are the rules that decide whether the server
 * accepts an order at all, and they are the kind of logic that is only ever wrong at 2am
 * on someone else's clock. Kept out of the Mongoose model so they can be exercised at
 * every awkward minute of the day without a database (see `time.test.js`).
 *
 * Two rules the whole file exists to get right:
 *
 * 1. **The window wraps past midnight.** 11:00 → 03:00 is not a range. The obvious
 *    `now >= open && now < close` is false at 1am and true at noon — exactly backwards.
 * 2. **Wall-clock, not offsets.** Everything resolves through the timezone database
 *    rather than a hardcoded +05:00. Pakistan does not observe DST today, but it has
 *    twice before, and the year it does again is not the year to discover the ordering
 *    cutoff was arithmetic on a fixed offset.
 */
import { BUSINESS_TIMEZONE } from '../config/constants.js'

const MINUTES_PER_DAY = 24 * 60
const MS_PER_MINUTE = 60_000

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

/** 'HH:MM' -> minutes since midnight. Throws rather than silently yielding NaN. */
export function parseTimeOfDay(value) {
  const match = TIME_OF_DAY.exec(String(value).trim())
  if (!match) {
    throw new TypeError(`Invalid time of day '${value}' — expected 'HH:MM' in 24-hour form`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Intl formatters are expensive to build and are asked for the same zone on every
 * request, so each one is created once and reused.
 */
const formatterCache = new Map()

function partsFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/** The wall-clock reading in `timeZone` at a given instant. */
function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  )

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some ICU versions render midnight as '24' under hour12:false rather than '00'.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** Minutes since local midnight in `timeZone`. */
export function minuteOfDayInZone(date = new Date(), timeZone = BUSINESS_TIMEZONE) {
  const { hour, minute } = zonedParts(date, timeZone)
  return hour * 60 + minute
}

/**
 * 'YYMMDD' for the local calendar date in `timeZone` — the date segment of an order
 * number (`SL-260810-0042`).
 *
 * The CALENDAR date, deliberately, not the trading night. An order placed at 01:00 on the
 * 11th belongs to the trading session that opened on the 10th, but it is numbered 260811
 * because that is the date on the customer's clock, on their receipt, and in the phone
 * call they make about it. A trading-day grouping is a reporting concern and belongs in
 * reports, not baked into an identifier that has to be read aloud.
 *
 * Resolved in Asia/Karachi, so a server running UTC does not roll the number over five
 * hours early and issue two orders the same sequence on different dates.
 */
export function businessDateStamp(date = new Date(), timeZone = BUSINESS_TIMEZONE) {
  const { year, month, day } = zonedParts(date, timeZone)
  const pad = (value) => String(value).padStart(2, '0')

  return `${pad(year % 100)}${pad(month)}${pad(day)}`
}

/** The zone's UTC offset, in ms, at a given instant. */
function offsetMsAt(date, timeZone) {
  const { year, month, day, hour, minute, second } = zonedParts(date, timeZone)
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  // Whole seconds only: Date.UTC above cannot carry the millisecond component.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * A wall-clock reading in `timeZone` -> the UTC instant it names.
 *
 * The offset cannot be known until the instant is known, and the instant cannot be known
 * until the offset is: guess using the offset in effect at the naive timestamp, then
 * re-check. The second pass only ever changes anything within an hour of a DST
 * transition, which is exactly the case a fixed offset gets wrong.
 */
function instantFromZonedWallClock({ year, month, day, hour, minute }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute)

  const firstGuess = naive - offsetMsAt(new Date(naive), timeZone)
  const refinedOffset = offsetMsAt(new Date(firstGuess), timeZone)

  return new Date(naive - refinedOffset)
}

/**
 * Straightens a wrapping window onto a single ascending number line.
 *
 * A close at or before the open belongs to the following day, so 11:00 → 03:00 becomes
 * 660 → 1620. Doing this once means the buffer subtraction below is a plain subtraction
 * for both window shapes — a pair of OR/AND branches breaks the moment the buffer itself
 * crosses midnight.
 *
 * `close === open` is read as a 24-hour window (always open), not a zero-length one.
 */
function straighten(openMinutes, closeMinutes) {
  return closeMinutes <= openMinutes ? closeMinutes + MINUTES_PER_DAY : closeMinutes
}

/** `at`, expressed on the same number line as a window that starts at `openMinutes`. */
function nowOnWindowLine(at, openMinutes, timeZone) {
  const now = minuteOfDayInZone(at, timeZone)
  // Earlier than the open time means we are in the post-midnight tail of the window
  // that began yesterday, not before today's opening.
  return now < openMinutes ? now + MINUTES_PER_DAY : now
}

/**
 * Is the branch trading at `at`, ignoring the last-order cutoff?
 *
 * `bufferMinutes` trims the END of the window: pass the branch's `lastOrderBufferMinutes`
 * to get the ordering window rather than the trading window.
 */
export function isOpenAt({
  open,
  close,
  at = new Date(),
  bufferMinutes = 0,
  timeZone = BUSINESS_TIMEZONE,
} = {}) {
  const openMinutes = parseTimeOfDay(open)
  const closeMinutes = straighten(openMinutes, parseTimeOfDay(close))
  const cutoff = closeMinutes - bufferMinutes

  // A buffer longer than the window leaves nothing orderable. Guard explicitly rather
  // than letting cutoff fall below open and quietly inverting the comparison.
  if (cutoff <= openMinutes) return false

  const now = nowOnWindowLine(at, openMinutes, timeZone)

  // Half-open: at exactly 03:00 the branch is shut, and at exactly the cutoff the
  // kitchen has stopped taking orders. Closing time is not one more orderable minute.
  return now >= openMinutes && now < cutoff
}

/** Open, and far enough from closing that the kitchen can still cook it. 11:00 – 02:30. */
export function isAcceptingOrdersAt({
  open,
  close,
  at = new Date(),
  bufferMinutes = 0,
  timeZone = BUSINESS_TIMEZONE,
} = {}) {
  return isOpenAt({ open, close, at, bufferMinutes, timeZone })
}

/**
 * The next instant the branch opens, strictly after `at`.
 *
 * This is what the "Closed — opens at 11am" rejection quotes back. It answers "when can I
 * next order?", so a caller at 02:31 — inside the trading window but past the cutoff —
 * correctly gets today's 11:00 rather than being told it is already open.
 */
export function nextOpeningAt({ open, at = new Date(), timeZone = BUSINESS_TIMEZONE } = {}) {
  const openMinutes = parseTimeOfDay(open)
  const { year, month, day } = zonedParts(at, timeZone)

  const todaysOpening = instantFromZonedWallClock(
    { year, month, day, hour: Math.floor(openMinutes / 60), minute: openMinutes % 60 },
    timeZone
  )

  if (todaysOpening.getTime() > at.getTime()) return todaysOpening

  // Already past today's opening — step a day forward in wall-clock terms. Adding 24h to
  // the instant would be wrong across a DST change; re-reading the calendar date is not.
  const tomorrow = zonedParts(new Date(todaysOpening.getTime() + MINUTES_PER_DAY * MS_PER_MINUTE), timeZone)

  return instantFromZonedWallClock(
    {
      year: tomorrow.year,
      month: tomorrow.month,
      day: tomorrow.day,
      hour: Math.floor(openMinutes / 60),
      minute: openMinutes % 60,
    },
    timeZone
  )
}

/**
 * Minutes left before the last-order cutoff, or `null` if orders are not being taken.
 *
 * Feeds the cart's "last orders in X minutes" countdown (design §5), so a customer
 * mid-checkout at 02:29 is warned rather than rejected at 02:31.
 */
export function minutesUntilLastOrder({
  open,
  close,
  at = new Date(),
  bufferMinutes = 0,
  timeZone = BUSINESS_TIMEZONE,
} = {}) {
  if (!isOpenAt({ open, close, at, bufferMinutes, timeZone })) return null

  const openMinutes = parseTimeOfDay(open)
  const cutoff = straighten(openMinutes, parseTimeOfDay(close)) - bufferMinutes

  return cutoff - nowOnWindowLine(at, openMinutes, timeZone)
}
