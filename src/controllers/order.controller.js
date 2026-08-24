import { ok, created } from '../views/respond.js'
import { orderView } from '../views/orderView.js'
import * as orderService from '../services/order.service.js'
import { renderOrderInvoice, invoiceFilename } from '../services/invoice.service.js'
import { sendPdf } from '../utils/sendPdf.js'

/** Thin by design: read the request, call the service, shape the response. */

function contextOf(req) {
  // Kept for the fraud trail on an order nobody has paid for yet. Stored, never returned.
  return { ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' }
}

export async function create(req, res) {
  // The verified phone comes off the token, never off the body — the body is the thing
  // being checked. See order.service.create.
  const order = await orderService.create(req.body, {
    ...contextOf(req),
    verifiedPhone: req.customer.phone,
  })

  return created(res, { order: orderView.customer(order) })
}

export async function getByNumber(req, res) {
  const order = await orderService.getByNumber(req.params.orderNumber, req.validatedQuery)

  return ok(res, { order: orderView.customer(order) })
}

export async function invoice(req, res) {
  // Same phone gate as the lookup above, via the same service call: order numbers are
  // sequential, so an invoice route that skipped it would hand over every customer's
  // address and basket by counting.
  const order = await orderService.getByNumber(req.params.orderNumber, req.validatedQuery)
  const pdf = await renderOrderInvoice(order, order.branchId)

  return sendPdf(res, pdf, invoiceFilename(order))
}
