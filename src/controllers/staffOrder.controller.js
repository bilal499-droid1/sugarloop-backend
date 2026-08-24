import { ok, paginated } from '../views/respond.js'
import { orderView } from '../views/orderView.js'
import * as staffOrderService from '../services/staffOrder.service.js'
import { renderOrderInvoice, invoiceFilename } from '../services/invoice.service.js'
import { sendPdf } from '../utils/sendPdf.js'

/** Thin by design: read the request, call the service, shape the response. */

function contextOf(req) {
  return { actor: req.staff, ip: req.ip ?? '' }
}

export async function list(req, res) {
  const { limit } = req.validatedQuery
  const { items, nextCursor } = await staffOrderService.list(req.validatedQuery, req.staff)

  return paginated(res, orderView.staffList(items), { limit, nextCursor })
}

export async function getOne(req, res) {
  const order = await staffOrderService.getById(req.params.id, req.staff)

  return ok(res, {
    order: orderView.staff(order),
    // What this order may do next, so the board renders one button per legal move
    // instead of guessing at the state machine and being refused by the server.
    transitions: staffOrderService.transitionsFor(order),
  })
}

export async function invoice(req, res) {
  // Reuses getById, so an order at another branch is a 404 here for the same reason it is
  // on the board — an invoice must not be the hole in the scoping rule.
  const order = await staffOrderService.getById(req.params.id, req.staff)
  const pdf = await renderOrderInvoice(order, order.branchId)

  return sendPdf(res, pdf, invoiceFilename(order))
}

export async function changeStatus(req, res) {
  const order = await staffOrderService.changeStatus(req.params.id, req.body, contextOf(req))

  return ok(res, {
    order: orderView.staff(order),
    transitions: staffOrderService.transitionsFor(order),
  })
}
