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

export async function resolveBranch({ fulfilment, location, branchId, branchCode }) {
  if (fulfilment === FULFILMENT.PICKUP) {
    return resolvePickupBranch({ branchId, branchCode })
  }

  // ⚠️ Step 9 will accept a street address here and geocode it to coordinates via Google
  // Maps. Until that lands the caller supplies { lat, lng } directly — the branch-matching
  // half is what this function does either way, and it is already correct.
  return resolveDeliveryBranch(location)
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
