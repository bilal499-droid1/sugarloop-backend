import { env } from '../config/env.js'
import { ok, noContent } from '../views/respond.js'
import { staffUserView } from '../views/staffUserView.js'
import { toMilliseconds } from '../utils/duration.js'
import * as staffAuthService from '../services/staffAuth.service.js'

export const REFRESH_COOKIE = 'sl_staff_refresh'

/**
 * Scoped to the auth routes, so the refresh token is not attached to every ordinary
 * API call. A cookie that only travels where it is needed is a cookie with a much
 * smaller surface to be logged by a proxy or captured by a mistaken handler.
 */
const COOKIE_PATH = '/api/v1/staff/auth'

function refreshCookieOptions() {
  return {
    httpOnly: true,
    // The dashboard is served from a different origin than the API in production, so
    // the cookie has to be SameSite=None — which browsers only accept with Secure.
    // In development that pairing would break plain-http localhost, and there the
    // dashboard and API are same-site anyway (ports don't affect site).
    sameSite: env.isProduction ? 'none' : 'lax',
    secure: env.isProduction,
    path: COOKIE_PATH,
    maxAge: toMilliseconds(env.JWT_STAFF_REFRESH_EXPIRES_IN),
  }
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions())
}

function clearRefreshCookie(res) {
  // maxAge must not be sent when clearing, and the rest of the attributes must match
  // the ones used to set it or the browser keeps the original cookie.
  const { maxAge: _maxAge, ...options } = refreshCookieOptions()
  res.clearCookie(REFRESH_COOKIE, options)
}

/** Cookie first, body second — a browser client should never have to hold the token. */
function readRefreshToken(req) {
  return req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken ?? null
}

function requestContext(req) {
  return { userAgent: req.get('user-agent') ?? '', ip: req.ip ?? '' }
}

export async function login(req, res) {
  const { email, password } = req.body

  const { staffUser, accessToken, refreshToken } = await staffAuthService.login({
    email,
    password,
    context: requestContext(req),
  })

  setRefreshCookie(res, refreshToken)

  // The access token goes in the body because it belongs in an Authorization header on
  // the next request, and it is short-lived by design. The refresh token — the durable
  // credential — stays in the httpOnly cookie where page scripts cannot reach it.
  return ok(res, { staffUser: staffUserView(staffUser), accessToken })
}

export async function refresh(req, res) {
  const { staffUser, accessToken, refreshToken } = await staffAuthService.refresh({
    refreshToken: readRefreshToken(req),
    context: requestContext(req),
  })

  setRefreshCookie(res, refreshToken)

  return ok(res, { staffUser: staffUserView(staffUser), accessToken })
}

export async function logout(req, res) {
  await staffAuthService.logout(readRefreshToken(req))
  clearRefreshCookie(res)
  return noContent(res)
}

/** Ends every session, everywhere. The "I lost my laptop" button. */
export async function logoutAll(req, res) {
  await staffAuthService.revokeAllSessions(req.staff._id)
  clearRefreshCookie(res)
  return noContent(res)
}

export async function me(req, res) {
  // requireStaff already loaded a fresh document, so this reflects a role or branch
  // change made a second ago rather than whatever the token was minted with.
  return ok(res, { staffUser: staffUserView(req.staff) })
}
