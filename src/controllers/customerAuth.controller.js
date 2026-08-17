import { env } from '../config/env.js'
import { ok, noContent } from '../views/respond.js'
import { toMilliseconds } from '../utils/duration.js'
import * as customerAuthService from '../services/customerAuth.service.js'

/** Thin by design: read the request, call the service, shape the response. */

export const CUSTOMER_COOKIE = 'sl_customer'

/**
 * Scoped to the whole API rather than one route, unlike the staff refresh cookie: this
 * session is presented on `POST /orders`, not just on the auth endpoints, so a narrower
 * path would simply never be sent.
 */
const COOKIE_PATH = '/api/v1'

function sessionCookieOptions() {
  return {
    httpOnly: true,
    // The storefront is a different origin from the API in production, so the cookie has
    // to be SameSite=None — which browsers only honour together with Secure. In
    // development that pairing breaks plain-http localhost, and there the two are
    // same-site anyway (differing ports do not make a different site).
    sameSite: env.isProduction ? 'none' : 'lax',
    secure: env.isProduction,
    path: COOKIE_PATH,
    maxAge: toMilliseconds(env.JWT_CUSTOMER_EXPIRES_IN),
  }
}

export async function requestOtp(req, res) {
  const result = await customerAuthService.requestOtp({
    phone: req.body.phone,
    ip: req.ip ?? '',
  })

  return ok(res, result)
}

export async function verifyOtp(req, res) {
  const { phone, token, expiresIn } = await customerAuthService.verifyOtp(req.body)

  res.cookie(CUSTOMER_COOKIE, token, sessionCookieOptions())

  /**
   * The token is returned in the body AS WELL as set as a cookie, and the two serve
   * different clients. A browser should rely on the httpOnly cookie, where no page
   * script can read a credential that lasts four days. Postman, curl and the test suite
   * have no cookie jar worth managing and send it as a bearer token instead. Both are
   * accepted by `requireCustomer`.
   */
  return ok(res, { phone, token, expiresIn })
}

export async function me(req, res) {
  return ok(res, { phone: req.customer.phone })
}

export async function logout(_req, res) {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions()
  res.clearCookie(CUSTOMER_COOKIE, options)
  return noContent(res)
}
