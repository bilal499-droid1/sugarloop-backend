/**
 * Loads what the pricing engine needs, then calls it.
 *
 * Everything that touches the database lives here; every rule about money lives in
 * pricing.engine.js. The split is deliberate — the engine can then be tested at every
 * awkward edge without a Mongo instance, and this file stays small enough to read.
 */
import { Product } from '../models/Product.js'
import { Branch } from '../models/Branch.js'
import { BranchStock } from '../models/BranchStock.js'
import { ApiError } from '../utils/ApiError.js'
import {
  FULFILMENT,
  DEFAULT_MAX_DELIVERY_MINUTES,
  DEFAULT_MAX_DELIVERY_ROAD_KM,
} from '../config/constants.js'
import { priceCart } from './pricing.engine.js'
import { geocodeAddress } from './geocoding.service.js'
import { routeToBranches } from './routing.service.js'

/** Metres, generous — wide enough to find a branch worth reporting a distance for. */
const SEARCH_RADIUS_METRES = 30_000

/** Every product id the cart references, boxes included, de-duplicated. */
function referencedProductIds(items) {
  const ids = new Set()

  for (const item of items) {
    if (item.kind === 'box') {
      item.productIds.forEach((id) => ids.add(String(id)))
    } else {
      ids.add(String(item.productId))
    }
  }

  return [...ids]
}
/**
 * The ride caps, defaulted in code rather than trusted from the document.
 *
 * `$geoNear` is an aggregation, so it yields PLAIN objects — Mongoose schema defaults do
 * not apply to them. A branch seeded before these fields existed therefore arrives with
 * both `undefined`, and `undefined * 1000` is NaN, and every comparison against NaN is
 * false. That would refuse every delivery in the country until someone re-seeded, which
 * is a deployment ordering nobody should have to know about.
 */
const capMinutes = (branch) => branch.maxDeliveryMinutes ?? DEFAULT_MAX_DELIVERY_MINUTES
const capRoadKm = (branch) => branch.maxDeliveryRoadKm ?? DEFAULT_MAX_DELIVERY_ROAD_KM

/**
 * The branch a delivery to these coordinates belongs to.
 *
 * Two stages, because the cheap test and the correct test are different tests.
 *
 * `$geoNear` first, as an indexed pre-filter. A road can never be shorter than a straight
 * line, so any branch whose straight-line distance already exceeds its road cap cannot
 * possibly be in range, and can be dropped before a router is troubled with it. That one
 * fact is what keeps this to a single routing request no matter how many shops exist.
 *
 * Then the survivors are routed for real, and judged on BOTH limits — ride time and road
 * distance. The winner is the QUICKEST, not the closest: the customer is waiting on
 * minutes, not kilometres, and the two do not always agree. From one Westridge address
 * the NUST shop is 9.97 km / 15 min while DHA 1 is 13.17 km / 16 min — three kilometres
 * further, one minute slower.
 *
 * Whether that branch is open is NOT considered here. Branches do not cover for each
 * other, so a closed nearest branch is a refusal, not a reason to look further out.
 */
async function resolveDeliveryBranch({ lat, lng }) {
  const candidates = await Branch.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMetres',
        maxDistance: SEARCH_RADIUS_METRES,
        spherical: true,
        query: { isActive: true, fulfilment: FULFILMENT.DELIVERY },
      },
    },
    { $limit: 10 },
  ])

  const origin = { lat, lng }
  const routes = await routeToBranches(origin, candidates)

  const measured = candidates.map((branch, index) => {
    const route = routes[index]

    // Distance decides. Without a router there is no road distance to judge, so the
    // straight-line radius is the only rule that can be applied — the original
    // behaviour, unchanged.
    //
    // A time cap is supported but OFF by default (`maxDeliveryMinutes: null`), because
    // the client's rule is a distance: "we deliver up to 5 km". Leaving a second,
    // invisible limit switched on would mean refusing someone inside 5 km for a reason
    // the message does not state — and at 5 km of road nothing takes twenty minutes
    // anyway, so it never bound. Ride time is still MEASURED and still shown; it just
    // does not decide.
    const minutesCap = capMinutes(branch)
    const inRange = route.estimated
      ? branch.distanceMetres <= branch.deliveryRadiusKm * 1000
      : route.roadMetres <= capRoadKm(branch) * 1000 &&
        (minutesCap == null || route.seconds <= minutesCap * 60)

    return { branch, route, inRange }
  })

  // Quickest first where times are known; `$geoNear` already sorted by distance, which is
  // the only ordering available when they are not.
  const ranked = measured.every((entry) => entry.route.seconds === null)
    ? measured
    : [...measured].sort((a, b) => (a.route.seconds ?? Infinity) - (b.route.seconds ?? Infinity))

  const chosen = ranked.find((entry) => entry.inRange)

  if (!chosen) {
    const nearest = ranked[0]

    throw new ApiError(
      409,
      'OUTSIDE_DELIVERY_AREA',
      'We do not deliver to this address yet',
      nearest
        ? {
            nearestBranch: nearest.branch.name,
            // Kept for compatibility: this field has always been straight-line, and the
            // storefront has always labelled it as a plain distance.
            distanceKm: Number((nearest.branch.distanceMetres / 1000).toFixed(2)),
            deliveryRadiusKm: nearest.branch.deliveryRadiusKm,
            // Present only when a router answered. The storefront says "15 minutes away
            // (9.9 km by road)" when they are here, and falls back to the straight-line
            // sentence when they are not, rather than inventing a ride time.
            ...(nearest.route.estimated
              ? {}
              : {
                  roadKm: Number((nearest.route.roadMetres / 1000).toFixed(2)),
                  minutes: Math.round(nearest.route.seconds / 60),
                  maxDeliveryRoadKm: capRoadKm(nearest.branch),
                  maxDeliveryMinutes: capMinutes(nearest.branch),
                }),
          }
        : undefined
    )
  }

  // $geoNear yields plain objects; hydrate so the hours methods exist on it.
  const branch = Branch.hydrate(chosen.branch)
  branch.distanceKm = Number((chosen.branch.distanceMetres / 1000).toFixed(2))

  if (!chosen.route.estimated) {
    branch.roadKm = Number((chosen.route.roadMetres / 1000).toFixed(2))
    branch.rideMinutes = Math.round(chosen.route.seconds / 60)
  }

  return branch
}

/** Pickup: the customer chose the branch, so we only have to confirm it is real. */
async function resolvePickupBranch({ branchId, branchCode }) {
  const filter = branchId
    ? { _id: branchId, isActive: true }
    : { code: String(branchCode).toUpperCase(), isActive: true }

  const branch = await Branch.findOne(filter)
  if (!branch) throw ApiError.notFound('Branch not found')

  return branch
}

/**
 * Coordinates for a delivery, from whichever the customer gave us.
 *
 * `location` wins when both are present: a map pin or a device GPS fix is a more precise
 * statement of where someone is than a line of text, and geocoding an address they also
 * pinned would spend a paid lookup to produce a worse answer.
 */
export async function resolveDeliveryPoint({ location, address }) {
  if (location) return { ...location, source: 'coordinates' }

  if (!address) {
    throw ApiError.badRequest('Delivery needs either coordinates or an address')
  }

  const geocoded = await geocodeAddress(address)

  if (!geocoded) {
    throw new ApiError(
      422,
      'ADDRESS_NOT_FOUND',
      'We could not find that address. Please add more detail, or share your location.',
      { address }
    )
  }

  return {
    lat: geocoded.lat,
    lng: geocoded.lng,
    formattedAddress: geocoded.formattedAddress,
    source: 'address',
  }
}

/**
 * The branch that will fulfil this order.
 *
 * For delivery that is decided by WHERE the customer is, never by anything they chose —
 * branches serve their own 2 km radius and do not cover for each other.
 */
export async function resolveBranch({ fulfilment, location, addressText, branchId, branchCode }) {
  if (fulfilment === FULFILMENT.PICKUP) {
    return resolvePickupBranch({ branchId, branchCode })
  }

  /**
   * `addressText`, NOT `address`. An order request carries both, and they are different
   * things: `addressText` is the free-text line to geocode, while `address` is the
   * structured `{ line1, area, city, notes }` object printed for the rider. Reading
   * `address` here would hand an object to the geocoder.
   */
  const point = await resolveDeliveryPoint({ location, address: addressText })
  const branch = await resolveDeliveryBranch(point)

  // Carried so the order can snapshot the coordinates actually used, which for an
  // address-only checkout were never in the request.
  branch.$resolvedPoint = point

  return branch
}

/**
 * Public branch resolution for `POST /branches/resolve` — "do you deliver to me, and
 * from where?", answered before the customer has built a cart.
 */
export async function resolveDeliveryTarget({ location, address }) {
  const point = await resolveDeliveryPoint({ location, address })
  const branch = await resolveDeliveryBranch(point)

  return { branch, point }
}

/**
 * Prices a cart. Used by `POST /checkout/quote` and, shortly, by `POST /orders`.
 *
 * `now` is threaded through rather than read inside, so the opening-hours gate can be
 * tested and so a quote and the order made from it are judged against one instant.
 */
export async function quote(request, { now = new Date() } = {}) {
  const branch = await resolveBranch(request)

  // Fresh from the database every time. A price the client sent is never consulted, and a
  // price cached in this process would go stale the moment an admin changed one.
  const products = await Product.find({
    _id: { $in: referencedProductIds(request.items) },
    isActive: true,
  })

  const productsById = new Map(products.map((product) => [String(product._id), product]))

  const stockRows = await BranchStock.find(
    { branchId: branch._id, productId: { $in: products.map((p) => p._id) } },
    'productId inStock'
  ).lean()

  const stockByProduct = new Map(stockRows.map((row) => [String(row.productId), row.inStock]))

  // Missing row means in stock, matching the BranchStock default and the seed. A product
  // created before its stock rows exist should not be invisible at every branch.
  const isInStock = (productId) => stockByProduct.get(String(productId)) ?? true

  return priceCart({
    items: request.items,
    fulfilment: request.fulfilment,
    branch,
    productsById,
    isInStock,
    now,
  })
}
