/**
 * Turning what a customer types into a point on the map.
 *
 * Two providers, chosen by `GEOCODER`, following the same pattern as OTP delivery:
 *
 *   google      the intended production provider. Needs GOOGLE_MAPS_API_KEY and billing
 *               enabled on a Google Cloud project — a client deliverable that does not
 *               exist yet.
 *   nominatim   OpenStreetMap. Free, no key, works today. Rate-limited to about one
 *               request per second and materially worse at Pakistani addresses, so it is
 *               a stand-in rather than an answer.
 *
 * ⚠️ **The key belongs here, on the server, and nowhere else.** A Maps key shipped to the
 * browser is a key anyone can read out of the bundle and spend against the client's
 * billing account. That — plus the fact that a paid lookup wants a cache the browser
 * cannot provide — is the whole reason this endpoint exists rather than the storefront
 * calling a geocoder directly.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { ApiError } from '../utils/ApiError.js'
import { GeocodeCache, cacheKey } from '../models/GeocodeCache.js'

/** Days a cached result stays good. Long enough to be free for repeat customers, short
 *  enough that a newly-mapped street is picked up in a sensible time. */
const CACHE_DAYS = 90

const TIMEOUT_MS = 6000

/**
 * Bias every lookup toward Pakistan.
 *
 * Without it, "Sector E" matches places on three continents and the nearest-branch check
 * then refuses a perfectly deliverable address because the geocoder put it in Ohio.
 */
const COUNTRY = 'pk'

/** Roughly the bounding box of Islamabad/Rawalpindi, to bias results toward the city. */
const VIEWBOX = { minLng: 72.8, minLat: 33.4, maxLng: 73.3, maxLat: 33.8 }

async function fetchJson(url, { headers } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) {
      throw ApiError.internal(`Geocoder responded ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Google Geocoding API.
 *
 * `ZERO_RESULTS` is a successful response that found nothing — distinct from an error, and
 * cached as `notFound` so the same unplaceable address is not paid for twice.
 */
async function geocodeWithGoogle(query) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', query)
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY)
  url.searchParams.set('components', `country:${COUNTRY}`)

  const data = await fetchJson(url)

  if (data.status === 'ZERO_RESULTS') return null

  if (data.status !== 'OK') {
    // REQUEST_DENIED and OVER_QUERY_LIMIT are configuration and billing problems, not
    // customer problems, so they are logged loudly rather than reported as a bad address.
    logger.error({ status: data.status, error: data.error_message }, 'Google geocoding failed')
    throw ApiError.internal('Address lookup is unavailable right now')
  }

  const best = data.results[0]
  return {
    lat: best.geometry.location.lat,
    lng: best.geometry.location.lng,
    formattedAddress: best.formatted_address ?? '',
  }
}

/** OpenStreetMap Nominatim. Requires a identifying User-Agent by its usage policy. */
async function geocodeWithNominatim(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', COUNTRY)
  url.searchParams.set('accept-language', 'en')
  url.searchParams.set(
    'viewbox',
    `${VIEWBOX.minLng},${VIEWBOX.maxLat},${VIEWBOX.maxLng},${VIEWBOX.minLat}`
  )

  const results = await fetchJson(url, {
    headers: { 'User-Agent': 'Sugarloop/1.0 (ordering API)', Accept: 'application/json' },
  })

  if (!Array.isArray(results) || results.length === 0) return null

  const best = results[0]
  return {
    lat: Number(best.lat),
    lng: Number(best.lon),
    formattedAddress: best.display_name ?? '',
  }
}

const PROVIDERS = {
  google: geocodeWithGoogle,
  nominatim: geocodeWithNominatim,
}

/**
 * Refuses to start with `GEOCODER=google` and no key — a misconfiguration that would
 * otherwise surface as every delivery address being rejected at checkout.
 */
export function assertGeocoderIsConfigured() {
  if (env.GEOCODER === 'google' && !env.GOOGLE_MAPS_API_KEY) {
    console.error('\nRefusing to start: GEOCODER=google but GOOGLE_MAPS_API_KEY is not set.\n')
    process.exit(1)
  }

  if (env.isProduction && env.GEOCODER === 'nominatim') {
    // Not fatal — a stand-in geocoder is a quality problem, not a security one — but it
    // must not pass unnoticed into production.
    logger.warn(
      'GEOCODER=nominatim in production: OpenStreetMap is rate-limited to ~1 req/s and is ' +
        'weak on Pakistani addresses. Switch to google before real traffic.'
    )
  }
}

/* -------------------------------------------------------------------------- */

/**
 * An address to `{ lat, lng }`, cached.
 *
 * Returns null when the provider genuinely cannot place the address — the caller turns
 * that into a message the customer can act on, rather than a 500.
 */
export async function geocodeAddress(query, { now = new Date() } = {}) {
  const key = cacheKey(query)
  if (!key) return null

  const cached = await GeocodeCache.findOne({ key })
  if (cached && cached.expiresAt > now) {
    if (cached.notFound) return null
    const [lng, lat] = cached.location.coordinates
    return { lat, lng, formattedAddress: cached.formattedAddress, cached: true }
  }

  const geocode = PROVIDERS[env.GEOCODER]
  if (!geocode) throw ApiError.internal(`Unknown GEOCODER: ${env.GEOCODER}`)

  const result = await geocode(query)
  const expiresAt = new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000)

  // Upsert rather than create: a concurrent request for the same address would otherwise
  // race on the unique key, and the second one would fail for no reason the customer
  // could understand.
  await GeocodeCache.updateOne(
    { key },
    {
      $set: {
        query,
        provider: env.GEOCODER,
        notFound: result === null,
        expiresAt,
        formattedAddress: result?.formattedAddress ?? '',
        location: {
          type: 'Point',
          // A not-found entry still needs a valid point to satisfy the schema; [0,0] is
          // never read, because `notFound` is checked first.
          coordinates: result ? [result.lng, result.lat] : [0, 0],
        },
      },
    },
    { upsert: true }
  )

  return result ? { ...result, cached: false } : null
}
