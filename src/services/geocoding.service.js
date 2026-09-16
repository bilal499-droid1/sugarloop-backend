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

/**
 * Bumped whenever the match-precision rules change, to retire entries the old rules
 * wrote. See `rulesRevision` on GeocodeCache.
 */
const RULES_REVISION = 1

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

/**
 * How coarse a match may be before it is a lie.
 *
 * This is the fix for a genuinely misleading bug: a customer 10 km outside the delivery
 * area was told the nearest shop was 3.65 km away. Nothing was wrong with the distance —
 * the POINT was wrong. Nominatim with `bounded=1` never says "no"; when it cannot find
 * the house it returns the best thing it CAN find inside the viewbox, which for a typed
 * Islamabad address is usually the sector itself. "H-13, Islamabad" comes back as
 * `addresstype: suburb` with a bounding box about 4 km tall, and its centroid was then
 * treated as a doorstep.
 *
 * With a 2 km delivery radius, a sector centroid is not a small error — it decides
 * whether someone can order at all, and it quotes them a confident distance that is off
 * by kilometres. So a match that only locates an AREA is treated as not found, which
 * puts the customer on the "add more detail, or share your location" path that already
 * exists and is honest. A GPS pin is unaffected: it never comes through here.
 */
const MAX_MATCH_SPAN_METRES = 1200

/**
 * Place types that describe a region rather than an address, whatever their box says.
 *
 * Kept alongside the span test rather than instead of it: a small suburb can have a
 * deceptively tight bounding box, and an unfamiliar type with a huge one is caught by
 * the span even if it is not listed here.
 */
const COARSE_ADDRESS_TYPES = new Set([
  'suburb',
  'neighbourhood',
  'quarter',
  'city_district',
  'district',
  'borough',
  'city',
  'town',
  'village',
  'hamlet',
  'municipality',
  'county',
  'state_district',
  'state',
  'province',
  'region',
  'country',
  'postcode',
  'administrative',
])

/** Metres per degree of latitude. Longitude is scaled by the cosine of the latitude. */
const METRES_PER_DEGREE = 111_320

/**
 * The larger side of a Nominatim `boundingbox`, in metres.
 *
 * Returns null when there is no usable box — an absent box is not evidence of a bad
 * match, so the type check is left to judge it alone rather than rejecting on silence.
 */
function boundingBoxSpanMetres(boundingbox) {
  if (!Array.isArray(boundingbox) || boundingbox.length !== 4) return null

  const [minLat, maxLat, minLng, maxLng] = boundingbox.map(Number)
  if ([minLat, maxLat, minLng, maxLng].some((value) => !Number.isFinite(value))) return null

  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180)
  const heightMetres = Math.abs(maxLat - minLat) * METRES_PER_DEGREE
  const widthMetres = Math.abs(maxLng - minLng) * METRES_PER_DEGREE * Math.cos(midLat)

  return Math.max(heightMetres, widthMetres)
}

/** Whether a Nominatim result pins a place precisely enough to deliver to. */
function isDeliverablePrecision(result) {
  const addressType = String(result.addresstype ?? result.type ?? '').toLowerCase()
  if (COARSE_ADDRESS_TYPES.has(addressType)) return false

  const span = boundingBoxSpanMetres(result.boundingbox)
  return span === null || span <= MAX_MATCH_SPAN_METRES
}

/**
 * Google's own verdict on how precisely it placed a result.
 *
 * `APPROXIMATE` is exactly the failure this module now refuses: Google saying "somewhere
 * in this area". The result types are checked too, because a `locality` or `postal_code`
 * can come back as GEOMETRIC_CENTER and still be a whole sector.
 */
const COARSE_GOOGLE_TYPES = new Set([
  'political',
  'locality',
  'sublocality',
  'sublocality_level_1',
  'neighborhood',
  'postal_code',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
])

function isGooglePrecisionDeliverable(result) {
  if (result?.geometry?.location_type === 'APPROXIMATE') return false
  return !(result?.types ?? []).some((type) => COARSE_GOOGLE_TYPES.has(type))
}

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

  const best = data.results.find(isGooglePrecisionDeliverable)

  // Same rule as Nominatim: an area centroid is not an address. Google states the
  // distinction outright in `location_type`, so this needs no bounding-box arithmetic.
  if (!best) {
    logger.info(
      { query, matched: data.results[0]?.formatted_address },
      'Geocode rejected: no match precise enough to deliver to'
    )
    return null
  }

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
  // Was 1. The top hit is ranked by prominence, not precision, so a whole sector can
  // outrank the actual street inside it — asking for one result meant never seeing the
  // better match sitting behind it. We take the first result precise enough to deliver
  // to, which needs a few to choose from.
  url.searchParams.set('limit', '5')
  url.searchParams.set('countrycodes', COUNTRY)
  url.searchParams.set('accept-language', 'en')
  url.searchParams.set(
    'viewbox',
    `${VIEWBOX.minLng},${VIEWBOX.maxLat},${VIEWBOX.maxLng},${VIEWBOX.minLat}`
  )
  // Without this, viewbox only nudges ranking — a bad match outside Islamabad/Rawalpindi
  // can still win. `bounded=1` makes it a hard filter.
  url.searchParams.set('bounded', '1')

  const results = await fetchJson(url, {
    headers: { 'User-Agent': 'Sugarloop/1.0 (ordering API)', Accept: 'application/json' },
  })

  if (!Array.isArray(results) || results.length === 0) return null

  const best = results.find(isDeliverablePrecision)

  // Every match was an area, not an address. Reported as not found rather than as its
  // centroid — see MAX_MATCH_SPAN_METRES. Logged because a customer who cannot get an
  // address accepted is worth seeing, and the alternative is a silent wrong answer.
  if (!best) {
    logger.info(
      { query, matched: results[0]?.display_name, addresstype: results[0]?.addresstype },
      'Geocode rejected: no match precise enough to deliver to'
    )
    return null
  }

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
  // A hit must be both unexpired AND written under the current precision rules.
  if (cached && cached.expiresAt > now && cached.rulesRevision >= RULES_REVISION) {
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
        rulesRevision: RULES_REVISION,
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
