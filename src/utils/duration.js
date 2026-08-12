/**
 * '15m' -> 900000.
 *
 * jsonwebtoken understands these strings natively, but the refresh token is an opaque
 * random string rather than a JWT, so its expiry has to be computed here. Parsing the
 * same notation both places means JWT_STAFF_REFRESH_EXPIRES_IN means one thing.
 */
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

export function toMilliseconds(duration) {
  const match = /^(\d+)\s*([smhd])$/.exec(String(duration).trim())
  if (!match) {
    throw new TypeError(`Unsupported duration '${duration}' — expected a form like '15m' or '7d'`)
  }
  return Number(match[1]) * UNITS[match[2]]
}
