/**
 * Reads of the public menu.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. **`isActive: false` never leaves the building.** A discontinued product is kept for
 *    order history, not for sale, and the filter belongs here rather than in a controller
 *    where the next endpoint will forget it.
 * 2. **Stock is per branch and is never guessed.** Without a `branchId` there is no
 *    correct answer to "is this in stock", so the field is omitted rather than defaulted
 *    to `true` — an absent field makes a frontend ask, a wrong `true` makes it lie.
 */
import { Product } from '../models/Product.js'
import { Branch } from '../models/Branch.js'
import { BranchStock } from '../models/BranchStock.js'
import { ApiError } from '../utils/ApiError.js'

/**
 * Resolves a branch the caller named, or throws.
 *
 * A bogus or deactivated `branchId` must not fall through to "here is the whole menu,
 * everything in stock" — that reads as a successful answer to a question we could not
 * actually answer.
 */
async function requireActiveBranch(branchId) {
  const branch = await Branch.findOne({ _id: branchId, isActive: true })
  if (!branch) throw ApiError.notFound('Branch not found')
  return branch
}

/**
 * `{ productId -> inStock }` for one branch.
 *
 * A product with no stock row is treated as IN stock, matching the BranchStock default
 * and the seed's `$setOnInsert`. The alternative — defaulting to sold out — means any
 * product created before its stock rows exist is invisible at every branch, which is a
 * silent outage rather than a visible one. Checkout re-checks stock at order time
 * regardless, so this is a display default, not the last line of defence.
 */
async function stockMapFor(branchId, productIds) {
  const rows = await BranchStock.find(
    { branchId, productId: { $in: productIds } },
    'productId inStock'
  ).lean()

  const map = new Map(rows.map((row) => [String(row.productId), row.inStock]))

  return (productId) => map.get(String(productId)) ?? true
}

export async function listProducts({ category, type, branchId, boxEligible, limit } = {}) {
  const filter = { isActive: true }
  if (category) filter.category = category
  if (type) filter.type = type
  if (boxEligible !== undefined) filter.boxEligible = boxEligible

  // Validate the branch BEFORE the product query, so a bad branchId costs one round trip
  // and returns 404 rather than a menu the caller will misread.
  const branch = branchId ? await requireActiveBranch(branchId) : null

  // Sort matches the { category, sortOrder, name } index, so this is served without an
  // in-memory sort stage. Name breaks ties, so the menu order is stable between requests
  // rather than depending on which documents the storage engine returns first.
  const products = await Product.find(filter)
    .sort({ category: 1, sortOrder: 1, name: 1 })
    .limit(limit)

  if (!branch) return { products, stockOf: null }

  const stockOf = await stockMapFor(branch._id, products.map((product) => product._id))

  return { products, stockOf }
}

export async function getProductBySlug(slug, { branchId } = {}) {
  const branch = branchId ? await requireActiveBranch(branchId) : null

  const product = await Product.findOne({ slug, isActive: true })
  if (!product) throw ApiError.notFound('Product not found')

  if (!branch) return { product, inStock: undefined }

  const stockOf = await stockMapFor(branch._id, [product._id])

  return { product, inStock: stockOf(product._id) }
}

/** Looked up by `code` rather than id — 'DHA2' is what appears in URLs and on tickets. */
export async function getBranchByCode(code) {
  const branch = await Branch.findOne({ code: String(code).toUpperCase(), isActive: true })
  if (!branch) throw ApiError.notFound('Branch not found')
  return branch
}

export async function listBranches({ fulfilment } = {}) {
  const filter = { isActive: true }
  if (fulfilment) filter.fulfilment = fulfilment

  // Deliberately not sorted by distance — that needs the customer's coordinates and is
  // what POST /branches/resolve is for (Step 9). This is the "our locations" list.
  return Branch.find(filter).sort({ code: 1 })
}
