/**
 * How far a delivery actually is, by road.
 *
 * The original rule measured straight-line distance and compared it against a 2 km
 * radius. That is cheap and indexable, and it is wrong in a way customers notice: a
 * Westridge address 3.65 km from the NUST H-12 shop in a straight line is a 9.97 km
 * ride, because Nur Khan airbase sits between the two and the road has to go around it.
 * Meanwhile a DHA address 10.33 km out is only a 13.17 km ride. The detour factor ranges
 * from 1.2x to 2.7x across this city, so no multiplier on straight-line distance can
 * stand in for the real thing — it needs the road graph.
 *
 * Two providers, chosen by `ROUTER`, following the same pattern as the geocoder:
 *
 *   straightline  the original behaviour, kept as the default and as the fallback when a
 *                 router is configured but unreachable. Answers with distance only.
 *   osrm          a self-hosted OSRM server. No key, no per-request cost, no rate limit,
 *                 and the same OpenStreetMap data the geocoder already uses.
 *
 * **One request answers for every branch at once.** OSRM's `/table` service takes one
 * source and many destinations, so resolving a delivery costs a single HTTP call no
 * matter how many shops are in range — and it returns distance AND duration together, so
 * having both costs nothing over having either.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { RouteCache, routeCacheKey } from '../models/RouteCache.js'

const TIMEOUT_MS = 4000

/** Days a cached route stays good. Roads change slowly; this is mostly about volume. */
const CACHE_DAYS = 30

/**
 * Great-circle distance in metres — the same measure `$geoNear` reports.
 *
 * Kept here as well as in the database because the pre-filter and the fallback both need
 * it in Node, and because a straight line is the floor for a road distance: no route can
 * be shorter than it. That fact is what makes the cheap `$geoNear` pre-filter safe.
 */
export function straightLineMetres(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2

  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/* -------------------------------------------------------------------------- */

/**
 * Refuses to start with `ROUTER=osrm` and no server — a misconfiguration that would
 * otherwise surface as every delivery quietly falling back to straight-line distance,
 * which is the bug this module exists to fix and would be invisible in production.
 */
export function assertRouterIsConfigured() {
  if (env.ROUTER === 'osrm' && !env.OSRM_URL) {
    console.error('\nRefusing to start: ROUTER=osrm but OSRM_URL is not set.\n')
    process.exit(1)
  }
}

/**
 * Ask OSRM for the road distance and ride time from one origin to many destinations.
 *
 * Returns an array positionally matching `destinations`, each `{ roadMetres, seconds }`
 * or null where the router could not find a route. Returns null overall — not an array —
 * when the router itself failed, which the caller distinguishes: one unroutable address
 * is a refusal, a router that is down is a reason to fall back rather than to close.
 */
async function routeWithOsrm(origin, destinations) {
  const coordinates = [origin, ...destinations]
    .map((point) => `${point.lng},${point.lat}`)
    .join(';')

  const url = new URL(`${env.OSRM_URL.replace(/\/+$/, '')}/table/v1/driving/${coordinates}`)
  url.searchParams.set('sources', '0')
  url.searchParams.set('annotations', 'distance,duration')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`OSRM responded ${response.status}`)

    const data = await response.json()
    if (data.code !== 'Ok') throw new Error(`OSRM said ${data.code}`)

    // Both annotations come back as a one-row matrix, the row being our single source.
    const metres = data.distances?.[0] ?? []
    const seconds = data.durations?.[0] ?? []

    // Index 0 is the origin to itself. The destinations start at 1.
    return destinations.map((_, index) => {
      const roadMetres = metres[index + 1]
      const rideSeconds = seconds[index + 1]

      return Number.isFinite(roadMetres) && Number.isFinite(rideSeconds)
        ? { roadMetres, seconds: rideSeconds }
        : null
    })
  } catch (error) {
    logger.warn({ err: error?.message }, 'Routing failed; falling back to straight-line')
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Road distance and ride time from a customer to each branch, cached.
 *
 * Every entry comes back shaped the same way, whichever provider answered:
 *
 *   { roadMetres, seconds, straightMetres, estimated }
 *
 * `estimated: true` means no router answered and the numbers are straight-line — the
 * caller must not present those as a ride time. `seconds` is null in that case rather
 * than a fabricated figure: there is no honest way to turn a straight line into minutes.
 *
 * Cached per (rounded origin, branch). Rounding to five decimals is about a metre, which
 * is far finer than any route differs by, and it means a customer retrying a checkout —
 * or nudging their pin — reuses the answer instead of asking again.
 */
export async function routeToBranches(origin, branches, { now = new Date() } = {}) {
  const straight = branches.map((branch) => {
    const [lng, lat] = branch.location.coordinates
    return straightLineMetres(origin, { lat, lng })
  })

  if (env.ROUTER === 'straightline') {
    return straight.map((straightMetres) => ({
      roadMetres: straightMetres,
      seconds: null,
      straightMetres,
      estimated: true,
    }))
  }

  const keys = branches.map((branch) => routeCacheKey(origin, branch._id))
  const cached = await RouteCache.find({ key: { $in: keys }, expiresAt: { $gt: now } })
  const byKey = new Map(cached.map((row) => [row.key, row]))

  // Only the misses go to the router, and they go in one request rather than one each.
  const misses = branches
    .map((branch, index) => ({ branch, index }))
    .filter(({ index }) => !byKey.has(keys[index]))

  let routed = null
  if (misses.length > 0) {
    routed = await routeWithOsrm(
      origin,
      misses.map(({ branch }) => {
        const [lng, lat] = branch.location.coordinates
        return { lat, lng }
      })
    )
  }

  const writes = []
  const results = branches.map((_, index) => ({
    roadMetres: straight[index],
    seconds: null,
    straightMetres: straight[index],
    estimated: true,
  }))

  for (const [position, { index }] of misses.entries()) {
    const leg = routed?.[position]
    if (!leg) continue

    results[index] = { ...leg, straightMetres: straight[index], estimated: false }
    writes.push({
      updateOne: {
        filter: { key: keys[index] },
        update: {
          $set: {
            key: keys[index],
            roadMetres: leg.roadMetres,
            seconds: leg.seconds,
            provider: env.ROUTER,
            expiresAt: new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000),
          },
        },
        upsert: true,
      },
    })
  }

  for (const [index, key] of keys.entries()) {
    const row = byKey.get(key)
    if (!row) continue

    results[index] = {
      roadMetres: row.roadMetres,
      seconds: row.seconds,
      straightMetres: straight[index],
      estimated: false,
    }
  }

  // Awaited, not fired and forgotten. A write that lands after the caller has moved on
  // is a write that can land after the NEXT request has already missed the cache — and
  // in tests, after the next case has cleared it, which is how a stale row reappears in
  // a suite that passes alone. The cost is one small upsert on a path that has just
  // waited on a network round trip; the catch keeps a cache failure from failing a
  // checkout, which is the only reason it was detached in the first place.
  if (writes.length > 0) {
    try {
      await RouteCache.bulkWrite(writes)
    } catch (error) {
      logger.warn({ err: error?.message }, 'Could not cache routes')
    }
  }

  return results
}
