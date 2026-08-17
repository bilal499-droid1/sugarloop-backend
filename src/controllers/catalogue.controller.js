import { ok } from '../views/respond.js'
import { productView, productListView } from '../views/productView.js'
import { branchView, branchListView } from '../views/branchView.js'
import * as catalogueService from '../services/catalogue.service.js'
import { resolveDeliveryTarget } from '../services/checkout.service.js'

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

/**
 * Which branch delivers to a place, if any.
 *
 * Refusal is the interesting case: an address outside every radius comes back as
 * `OUTSIDE_DELIVERY_AREA` naming the nearest shop and how far it is, so the customer is
 * told "we are 8.9 km away" rather than a bare no.
 */
export async function resolveBranch(req, res) {
  const { branch, point } = await resolveDeliveryTarget(req.body)

  return ok(res, {
    branch: branchView(branch),
    distanceKm: branch.distanceKm,
    /** Echoed so the client can show what the typed address was understood to mean, and
     *  can reuse the coordinates at checkout instead of paying for a second lookup. */
    resolved: {
      lat: point.lat,
      lng: point.lng,
      source: point.source,
      formattedAddress: point.formattedAddress ?? null,
    },
  })
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
