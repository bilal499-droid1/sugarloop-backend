import { ok, created, paginated } from '../views/respond.js'
import { staffProductView, staffProductListView } from '../views/productView.js'
import * as staffProductService from '../services/staffProduct.service.js'

/**
 * Thin by design (plan §2): read the request, call a service, shape the response.
 * No Mongoose, no business rules — those live in services/staffProduct.service.js.
 */

function contextOf(req) {
  return { actor: req.staff, ip: req.ip ?? '' }
}

export async function list(req, res) {
  const { limit } = req.validatedQuery
  const { items, nextCursor } = await staffProductService.list(req.validatedQuery)
  return paginated(res, staffProductListView(items), { limit, nextCursor })
}

export async function getOne(req, res) {
  const product = await staffProductService.getById(req.params.id)
  return ok(res, { product: staffProductView(product) })
}

export async function create(req, res) {
  const product = await staffProductService.create(req.body, contextOf(req))
  return created(res, { product: staffProductView(product) })
}

export async function update(req, res) {
  const product = await staffProductService.update(req.params.id, req.body, contextOf(req))
  return ok(res, { product: staffProductView(product) })
}

/** Discontinues rather than deletes — see the service. */
export async function remove(req, res) {
  const product = await staffProductService.remove(req.params.id, contextOf(req))
  return ok(res, { product: staffProductView(product) })
}
