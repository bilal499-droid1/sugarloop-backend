import { ok } from '../views/respond.js'
import { quoteView } from '../views/quoteView.js'
import * as checkoutService from '../services/checkout.service.js'

/** Thin by design: read the request, call the service, shape the response. */
export async function quote(req, res) {
  const priced = await checkoutService.quote(req.body)

  return ok(res, { quote: quoteView(priced) })
}
