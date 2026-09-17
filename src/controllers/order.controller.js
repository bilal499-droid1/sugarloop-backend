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

/**
 * What Meta needs to match this order to an ad click. `_fbp` and `_fbc` are cookies the
 * Pixel sets on the shop's own domain, so they arrive with the order request.
 *
 * The page URL falls back to the Origin header: helmet sends `Referrer-Policy: no-referrer`
 * with the shop's HTML, so on this server a Referer is the exception, not the rule.
 */
function trackingOf(req) {
  return {
    fbp: req.cookies?._fbp ?? '',
    fbc: req.cookies?._fbc ?? '',
    sourceUrl: req.get('referer') || req.get('origin') || '',
  }
}

export async function create(req, res) {
  // The verified email comes off the token, never off the body — the body is the thing
  // being checked. See order.service.create.
  const order = await orderService.create(req.body, {
    ...contextOf(req),
    verifiedEmail: req.customer.email,
    tracking: trackingOf(req),
  })

  return created(res, { order: orderView.customer(order) })
}

export async function getByNumber(req, res) {
  const order = await orderService.getByNumber(req.params.orderNumber, req.validatedQuery)

  return ok(res, { order: orderView.customer(order) })
}

export async function invoice(req, res) {
  // Same email gate as the lookup above, via the same service call: order numbers are
  // sequential, so an invoice route that skipped it would hand over every customer's
  // address and basket by counting.
  const order = await orderService.getByNumber(req.params.orderNumber, req.validatedQuery)
  const pdf = await renderOrderInvoice(order, order.branchId)

  return sendPdf(res, pdf, invoiceFilename(order))
}
