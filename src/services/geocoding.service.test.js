/**
 * Geocoding, without touching a real geocoder.
 *
 * `fetch` is stubbed throughout: these tests are about the CACHE and the not-found path,
 * which is where the money is. A test that actually called Nominatim would be slow, flaky,
 * and would burn somebody's rate limit to prove nothing about our own logic.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.GEOCODER ??= 'nominatim'
process.env.JWT_CUSTOMER_SECRET ??= 'test-customer-secret-at-least-16-chars'
process.env.JWT_STAFF_SECRET ??= 'test-staff-secret-at-least-16-chars-x'
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/sugarloop_test'

const { connectTestDatabase, disconnectTestDatabase } = await import('../testing/mongoTestDb.js')
const { connected, skip } = await connectTestDatabase('geocoding')

const { GeocodeCache, cacheKey } = await import('../models/GeocodeCache.js')
const { geocodeAddress } = await import('./geocoding.service.js')

const realFetch = globalThis.fetch
let calls = 0

/** Answers as Nominatim does, and counts how often it was asked. */
function stubFetch(results) {
  calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return { ok: true, json: async () => results }
  }
}

const ISLAMABAD = [
  { lat: '33.5312498', lon: '73.1574172', display_name: 'Nadir Arcade, DHA Phase II, Islamabad' },
]

test.beforeEach(async () => {
  if (connected) await GeocodeCache.deleteMany({})
})

test.after(async () => {
  globalThis.fetch = realFetch
  await disconnectTestDatabase(connected)
})

test('cacheKey collapses trivial differences', () => {
  assert.equal(cacheKey('House 12, Street 4, DHA'), cacheKey('house 12 street  4   dha'))
  assert.equal(cacheKey('  Sector-E.  '), cacheKey('sector e'))
  assert.notEqual(cacheKey('Sector E'), cacheKey('Sector F'))
})

test('an address resolves to coordinates', { skip }, async () => {
  stubFetch(ISLAMABAD)

  const result = await geocodeAddress('Nadir Arcade, DHA Phase 2')

  assert.equal(result.lat, 33.5312498)
  assert.equal(result.lng, 73.1574172)
  assert.equal(result.cached, false)
})

test('the second lookup is served from cache, not the provider', { skip }, async () => {
  stubFetch(ISLAMABAD)

  await geocodeAddress('Nadir Arcade, DHA Phase 2')
  const second = await geocodeAddress('nadir arcade,  dha phase 2')

  assert.equal(second.cached, true, 'the repeat must not reach the provider')
  assert.equal(calls, 1, 'geocoding is billed per lookup — one call for two asks')
  assert.equal(second.lat, 33.5312498)
})

test('an unplaceable address is cached as not-found', { skip }, async () => {
  stubFetch([])

  assert.equal(await geocodeAddress('qqqq zzzz nowhere at all'), null)
  assert.equal(await geocodeAddress('qqqq zzzz nowhere at all'), null)

  // Re-asking a paid API to fail again costs money to learn nothing.
  assert.equal(calls, 1)

  const row = await GeocodeCache.findOne({ key: cacheKey('qqqq zzzz nowhere at all') })
  assert.equal(row.notFound, true)
})

test('an expired entry is looked up again', { skip }, async () => {
  stubFetch(ISLAMABAD)
  await geocodeAddress('Nadir Arcade, DHA Phase 2')

  await GeocodeCache.updateOne(
    { key: cacheKey('Nadir Arcade, DHA Phase 2') },
    { $set: { expiresAt: new Date(Date.now() - 1000) } }
  )

  const again = await geocodeAddress('Nadir Arcade, DHA Phase 2')

  assert.equal(again.cached, false, 'streets get renamed — a stale entry must refresh')
  assert.equal(calls, 2)
})

test('an empty query never reaches the provider', { skip }, async () => {
  stubFetch(ISLAMABAD)

  assert.equal(await geocodeAddress('   '), null)
  assert.equal(calls, 0)
})

/* -------------------------------------------------------------------------- */
/* Match precision                                                             */
/*                                                                             */
/* The bug these cover: a customer 10.2 km outside the delivery area was told   */
/* the nearest shop was 3.65 km away. Nominatim, asked with bounded=1, had      */
/* answered a typed address with the centroid of the whole sector, and that     */
/* centroid was priced as if it were their doorstep.                            */
/* -------------------------------------------------------------------------- */

/** A sector: what Nominatim actually returns for "H-13, Islamabad". ~4 km tall. */
const SECTOR_CENTROID = {
  lat: '33.6366772',
  lon: '72.9754502',
  display_name: 'ایچ-13, Islamabad',
  addresstype: 'suburb',
  type: 'suburb',
  boundingbox: ['33.6166772', '33.6566772', '72.9554502', '72.9954502'],
}

/** A street inside that sector — small box, precise enough to deliver to. */
const STREET = {
  lat: '33.6553532',
  lon: '72.9637411',
  display_name: 'Street 4, G-13/1, Islamabad',
  addresstype: 'road',
  type: 'residential',
  boundingbox: ['33.6528412', '33.6558412', '72.9627411', '72.9647411'],
}

test('a sector centroid is refused rather than priced as an address', { skip }, async () => {
  stubFetch([SECTOR_CENTROID])

  assert.equal(
    await geocodeAddress('H-13, Islamabad'),
    null,
    'an area centroid must read as not-found, not as a doorstep'
  )
})

test('a precise match behind a coarse one is preferred', { skip }, async () => {
  // Nominatim ranks by prominence, not precision, so the sector can outrank the street.
  stubFetch([SECTOR_CENTROID, STREET])

  const result = await geocodeAddress('Street 4, G-13/1, Islamabad')

  assert.equal(result.lat, 33.6553532)
  assert.equal(result.lng, 72.9637411)
})

test('a result with no bounding box is judged on its type alone', { skip }, async () => {
  stubFetch([{ lat: '33.5312498', lon: '73.1574172', display_name: 'Nadir Arcade' }])

  const result = await geocodeAddress('Nadir Arcade, DHA Phase 2')

  assert.equal(result.lat, 33.5312498, 'silence about the box is not evidence of a bad match')
})

test('a cache entry from the old rules is looked up again', { skip }, async () => {
  stubFetch(ISLAMABAD)
  await geocodeAddress('Nadir Arcade, DHA Phase 2')

  // What every row written before the precision rules existed looks like.
  await GeocodeCache.updateOne(
    { key: cacheKey('Nadir Arcade, DHA Phase 2') },
    { $set: { rulesRevision: 0 } }
  )

  const again = await geocodeAddress('Nadir Arcade, DHA Phase 2')

  assert.equal(again.cached, false, 'a fix in the code must not be masked by the cache')
  assert.equal(calls, 2)
})
