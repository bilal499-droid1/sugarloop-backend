/**
 * Routing, without a real OSRM server.
 *
 * `fetch` is stubbed throughout. These tests are about the cache, the fallback, and the
 * one-request-for-many-branches shape — the parts that are ours. Whether OSRM can find a
 * road is OSRM's business, and a test that called it would be slow and flaky.
 *
 * The numbers used are the real ones measured from a Westridge address, because they are
 * what motivated this module: NUST H-12 is 3.65 km in a straight line and a 9.97 km /
 * 15 min ride, while DHA 1 is 10.33 km straight and a 13.17 km / 16 min ride. Further
 * away, but barely slower — which is why the rule ranks on time.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.ROUTER ??= 'osrm'
process.env.OSRM_URL ??= 'http://osrm.test'
process.env.JWT_CUSTOMER_SECRET ??= 'test-customer-secret-at-least-16-chars'
process.env.JWT_STAFF_SECRET ??= 'test-staff-secret-at-least-16-chars-x'
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/sugarloop_test'

const { connectTestDatabase, disconnectTestDatabase } = await import('../testing/mongoTestDb.js')
const { connected, skip } = await connectTestDatabase('routing')

const { RouteCache, routeCacheKey } = await import('../models/RouteCache.js')
const { routeToBranches, straightLineMetres } = await import('./routing.service.js')

const realFetch = globalThis.fetch
let calls = 0
let lastUrl = null

/** Answers as OSRM's /table does: a one-row matrix, origin first. */
function stubOsrm({ distances, durations }) {
  calls = 0
  lastUrl = null
  globalThis.fetch = async (url) => {
    calls += 1
    lastUrl = String(url)
    return {
      ok: true,
      json: async () => ({ code: 'Ok', distances: [[0, ...distances]], durations: [[0, ...durations]] }),
    }
  }
}

function stubUnreachable() {
  calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('connect ECONNREFUSED')
  }
}

const WESTRIDGE = { lat: 33.615576, lng: 73.011803 }

const branch = (id, lng, lat) => ({ _id: id, location: { type: 'Point', coordinates: [lng, lat] } })

const NUST = branch('aaaaaaaaaaaaaaaaaaaaaaaa', 72.9974445, 33.6461047)
const DHA1 = branch('bbbbbbbbbbbbbbbbbbbbbbbb', 73.0925354, 33.5515545)

test.beforeEach(async () => {
  if (connected) await RouteCache.deleteMany({})
})

test.after(async () => {
  globalThis.fetch = realFetch
  await disconnectTestDatabase(connected)
})

test('a straight line is the floor for a road distance', () => {
  const straight = straightLineMetres(WESTRIDGE, { lat: 33.6461047, lng: 72.9974445 })

  // 3.65 km, the figure the old rule reported and the customer disputed.
  assert.ok(Math.abs(straight - 3650) < 60, `expected ~3650 m, got ${Math.round(straight)}`)
  assert.ok(straight < 9965, 'the real ride is 9.97 km — the straight line must be shorter')
})

test('every branch is answered by ONE request', { skip }, async () => {
  stubOsrm({ distances: [9965.4, 13170], durations: [900, 960] })

  const routes = await routeToBranches(WESTRIDGE, [NUST, DHA1])

  assert.equal(calls, 1, 'two branches must not cost two round trips')
  assert.equal(routes[0].roadMetres, 9965.4)
  assert.equal(routes[0].seconds, 900)
  assert.equal(routes[1].roadMetres, 13170)
  assert.equal(routes[1].estimated, false)
})

test('distance and duration come back from the same call', { skip }, async () => {
  stubOsrm({ distances: [9965.4], durations: [900] })

  const [route] = await routeToBranches(WESTRIDGE, [NUST])

  assert.equal(route.roadMetres, 9965.4)
  assert.equal(route.seconds, 900)
  assert.match(lastUrl, /annotations=distance%2Cduration|annotations=distance,duration/)
})

test('a repeat is served from cache', { skip }, async () => {
  stubOsrm({ distances: [9965.4], durations: [900] })

  await routeToBranches(WESTRIDGE, [NUST])
  const [again] = await routeToBranches(WESTRIDGE, [NUST])

  assert.equal(calls, 1, 'routing sits in the checkout path — a repeat must not wait on it')
  assert.equal(again.roadMetres, 9965.4)
  assert.equal(again.seconds, 900)
})

test('a pin nudged by a metre reuses the same entry', { skip }, async () => {
  assert.equal(
    routeCacheKey({ lat: 33.6155761, lng: 73.0118031 }, NUST._id),
    routeCacheKey({ lat: 33.6155764, lng: 73.0118034 }, NUST._id)
  )
  assert.notEqual(
    routeCacheKey(WESTRIDGE, NUST._id),
    routeCacheKey(WESTRIDGE, DHA1._id),
    'the same origin to two branches is two different routes'
  )
})

test('a router that is down falls back to straight-line, flagged', { skip }, async () => {
  stubUnreachable()

  const [route] = await routeToBranches(WESTRIDGE, [NUST])

  assert.equal(route.estimated, true, 'the caller must be able to tell these are not real')
  assert.equal(route.seconds, null, 'there is no honest way to turn a straight line into minutes')
  assert.ok(Math.abs(route.roadMetres - 3650) < 60)
})

test('an unroutable branch is null, not a guess', { skip }, async () => {
  // OSRM reports no route as null in the matrix.
  stubOsrm({ distances: [null], durations: [null] })

  const [route] = await routeToBranches(WESTRIDGE, [NUST])

  assert.equal(route.estimated, true)
  assert.equal(route.seconds, null)
})
