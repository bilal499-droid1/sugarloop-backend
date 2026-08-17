/**
 * Per-branch stock toggles — the one write a branch manager is trusted with.
 *
 * Price is global and editable only by a developer seeding the catalogue; availability is
 * local and flipped by whoever is standing in front of the empty tray. That split is the
 * whole reason `BranchStock` exists as its own collection, and this file is its only
 * write path.
 *
 * A product with no stock row counts as IN stock, matching the model default, the seed's
 * `$setOnInsert`, and `catalogue.service.js`. The row is created on the first toggle —
 * which is why every write here is an upsert rather than an update.
 */
import { BranchStock } from '../models/BranchStock.js'
import { Product } from '../models/Product.js'
import { Branch } from '../models/Branch.js'
import { ApiError } from '../utils/ApiError.js'
import { assertBranchAccess } from '../middleware/auth.js'
import { STAFF_ROLE } from '../config/constants.js'
import * as audit from './audit.service.js'

/**
 * The branch this staff member is acting on.
 *
 * A branch manager has exactly one and may not name another. An admin has none, so they
 * MUST name one: there is no sensible "all branches" answer to "is this in stock", and
 * silently picking a branch for them would let a toggle land somewhere they did not look.
 */
async function resolveBranch(actor, requestedBranchId) {
  if (actor.role === STAFF_ROLE.ADMIN) {
    if (!requestedBranchId) {
      throw ApiError.validation('An admin must say which branch', [
        { field: 'branchId', message: 'Required — stock is per branch' },
      ])
    }

    const branch = await Branch.findOne({ _id: requestedBranchId, isActive: true })
    if (!branch) throw ApiError.notFound('Branch not found')
    return branch
  }

  if (requestedBranchId) assertBranchAccess(actor, requestedBranchId)

  const own = actor.branchId?._id ?? actor.branchId
  if (!own) throw ApiError.internal('This account has no branch assigned')

  const branch = await Branch.findById(own)
  if (!branch) throw ApiError.notFound('Branch not found')
  return branch
}

/**
 * The stock sheet for one branch: every sellable product, with its availability.
 *
 * Driven off the PRODUCT list rather than the stock rows, deliberately. A manager needs
 * to see the items that have never been toggled — those are precisely the ones with no
 * row — and a list built from `BranchStock` would show only the ones somebody had
 * already thought about.
 *
 * `isActive: false` products are excluded for the same reason the public catalogue
 * excludes them: a discontinued item is kept for order history, not for sale, and it
 * cannot be brought back by flipping a toggle.
 */
export async function list({ branchId, category, inStock } = {}, actor) {
  const branch = await resolveBranch(actor, branchId)

  const filter = { isActive: true }
  if (category) filter.category = category

  const products = await Product.find(filter).sort({ category: 1, sortOrder: 1, name: 1 })

  const rows = await BranchStock.find(
    { branchId: branch._id, productId: { $in: products.map((product) => product._id) } },
    'productId inStock updatedAt updatedBy'
  ).lean()

  const byProduct = new Map(rows.map((row) => [String(row.productId), row]))

  const items = products.map((product) => {
    const row = byProduct.get(String(product._id))
    return {
      product,
      inStock: row?.inStock ?? true,
      // Null where no row exists yet — "never been toggled", which reads differently on
      // a dashboard from "someone set it in stock this morning".
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    }
  })

  return {
    branch,
    items: inStock === undefined ? items : items.filter((item) => item.inStock === inStock),
  }
}

/**
 * Flips one product in or out of stock at one branch.
 *
 * Idempotent: setting a value it already has succeeds and is not audited. A dashboard
 * that re-sends the current state on a double-click should not fill the trail with
 * entries that record nothing, and 409-ing a no-op would be an error the operator cannot
 * act on.
 */
export async function setStock(productId, { inStock, branchId }, context) {
  const branch = await resolveBranch(context.actor, branchId)

  const product = await Product.findOne({ _id: productId, isActive: true })
  if (!product) throw ApiError.notFound('Product not found')

  const before = await BranchStock.findOne({ branchId: branch._id, productId: product._id })
  const wasInStock = before?.inStock ?? true

  const row = await BranchStock.findOneAndUpdate(
    { branchId: branch._id, productId: product._id },
    { $set: { inStock, updatedBy: context.actor._id } },
    // Upsert because the first toggle for a product is the row's creation — see the
    // file comment on why a missing row means "in stock" rather than "unknown".
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )

  if (wasInStock !== inStock) {
    await audit.record({
      actor: context.actor,
      action: 'stock.toggle',
      entity: 'BranchStock',
      entityId: row._id,
      changes: {
        branchCode: branch.code,
        sku: product.sku,
        inStock: { from: wasInStock, to: inStock },
      },
      ip: context.ip,
    })
  }

  return { branch, product, row }
}
