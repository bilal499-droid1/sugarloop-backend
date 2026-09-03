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

/**
 * Step 1 of the upload round trip: hand back a signed URL for one file.
 *
 * 201 rather than 200 — this creates the right to write one specific object, and the
 * body carries the key that right is for.
 */
export async function createImageUpload(req, res) {
  const upload = await staffProductService.createImageUpload(req.params.id, req.body)
  return created(res, { upload })
}

/** Step 3: the browser reports which key it wrote, and the service verifies it. */
export async function attachImage(req, res) {
  const product = await staffProductService.attachImage(req.params.id, req.body, contextOf(req))
  return created(res, { product: staffProductView(product) })
}

/** Takes the photo off the product and deletes the object behind it. */
export async function removeImage(req, res) {
  const product = await staffProductService.removeImage(req.params.id, req.body.key, contextOf(req))
  return ok(res, { product: staffProductView(product) })
}
