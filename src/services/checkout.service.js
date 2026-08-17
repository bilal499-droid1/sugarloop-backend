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
import { FULFILMENT } from '../config/constants.js'
import { priceCart } from './pricing.engine.js'
import { geocodeAddress } from './geocoding.service.js'

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
 * The branch a delivery to these coordinates belongs to.
 *
 * Nearest branch whose OWN radius covers the address — the radius is per branch, so a
 * single `maxDistance` cannot express it. $geoNear returns results already sorted by
 * distance, so the first one still in range is the nearest one in range.
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

  const inRange = candidates.find(
    (branch) => branch.distanceMetres <= branch.deliveryRadiusKm * 1000
  )

  if (!inRange) {
    const nearest = candidates[0]

    throw new ApiError(
      409,
      'OUTSIDE_DELIVERY_AREA',
      'We do not deliver to this address yet',
      nearest
        ? {
            nearestBranch: nearest.name,
            distanceKm: Number((nearest.distanceMetres / 1000).toFixed(2)),
            deliveryRadiusKm: nearest.deliveryRadiusKm,
          }
        : undefined
    )
  }

  // $geoNear yields plain objects; hydrate so the hours methods exist on it.
  const branch = Branch.hydrate(inRange)
  branch.distanceKm = Number((inRange.distanceMetres / 1000).toFixed(2))

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
