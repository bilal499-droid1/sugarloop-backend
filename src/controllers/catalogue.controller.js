import { ok } from '../views/respond.js'
import { productView, productListView } from '../views/productView.js'
import { branchView, branchListView } from '../views/branchView.js'
import * as catalogueService from '../services/catalogue.service.js'

/**
 * Thin by design (plan §2): read the request, call a service, shape the response.
 * No Mongoose, no business rules.
 */

export async function listProducts(req, res) {
  const { products, stockOf } = await catalogueService.listProducts(req.validatedQuery)

  return ok(res, productListView(products, stockOf), {
    count: products.length,
    branchId: req.validatedQuery.branchId ?? null,
  })
}

export async function getProduct(req, res) {
  const { product, inStock } = await catalogueService.getProductBySlug(
    req.params.slug,
    req.validatedQuery
  )

  return ok(res, { product: productView(product, { inStock }) })
}

export async function listBranches(req, res) {
  const branches = await catalogueService.listBranches(req.validatedQuery)

  // One clock for the whole response — otherwise two branches in the same payload can be
  // judged milliseconds apart, and at 02:30:00 exactly that is a visible contradiction.
  const at = new Date()

  return ok(res, branchListView(branches, { at }), { count: branches.length, at })
}

export async function getBranch(req, res) {
  const branch = await catalogueService.getBranchByCode(req.params.code)

  return ok(res, { branch: branchView(branch) })
}
