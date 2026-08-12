import { ok, created } from '../views/respond.js'
import { orderView } from '../views/orderView.js'
import * as orderService from '../services/order.service.js'

/** Thin by design: read the request, call the service, shape the response. */

function contextOf(req) {
  // Kept for the fraud trail on an order nobody has paid for yet. Stored, never returned.
  return { ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' }
}

export async function create(req, res) {
  const order = await orderService.create(req.body, contextOf(req))

  return created(res, { order: orderView.customer(order) })
}

export async function getByNumber(req, res) {
  const order = await orderService.getByNumber(req.params.orderNumber, req.validatedQuery)

  return ok(res, { order: orderView.customer(order) })
}
