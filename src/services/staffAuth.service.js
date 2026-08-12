import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { ApiError } from '../utils/ApiError.js'
import { toMilliseconds } from '../utils/duration.js'
import { StaffUser } from '../models/StaffUser.js'
import { StaffSession } from '../models/StaffSession.js'

const ISSUER = 'sugarloop'
const AUDIENCE = 'sugarloop-staff'

/**
 * Both token kinds carry an explicit `typ`. Without it, any staff-signed JWT is
 * interchangeable with any other, and a token minted for one purpose is accepted for
 * another. Customer tokens can't be confused with these at all — they are signed with
 * a different secret entirely (see config/env.js).
 */
const ACCESS_TYPE = 'staff_access'

/** Opaque, 384 bits. Not a JWT — see StaffSession for why. */
function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url')
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function signAccessToken(staffUser) {
  return jwt.sign(
    {
      typ: ACCESS_TYPE,
      role: staffUser.role,
      // Present for convenience in logs and the client UI. Authorisation still reads
      // the branch off the freshly-loaded StaffUser document, never off the token — a
      // token minted before a transfer would otherwise keep the old branch for 15
      // minutes after the move.
      branchId: staffUser.branchId ? String(staffUser.branchId) : null,
    },
    env.JWT_STAFF_SECRET,
    {
      subject: String(staffUser._id),
      expiresIn: env.JWT_STAFF_ACCESS_EXPIRES_IN,
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  )
}

export function verifyAccessToken(token) {
  let payload
  try {
    payload = jwt.verify(token, env.JWT_STAFF_SECRET, { issuer: ISSUER, audience: AUDIENCE })
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      // A distinct code, because this is the one 401 the client should respond to by
      // refreshing rather than by bouncing the user to the login screen.
      throw new ApiError(401, 'TOKEN_EXPIRED', 'Access token has expired')
    }
    throw ApiError.unauthorized('Invalid access token')
  }

  if (payload.typ !== ACCESS_TYPE) throw ApiError.unauthorized('Invalid access token')
  return payload
}

async function issueSession(staffUser, context = {}) {
  const refreshToken = generateRefreshToken()

  const session = await StaffSession.create({
    staffUserId: staffUser._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + toMilliseconds(env.JWT_STAFF_REFRESH_EXPIRES_IN)),
    userAgent: context.userAgent ?? '',
    ip: context.ip ?? '',
  })

  return { accessToken: signAccessToken(staffUser), refreshToken, session }
}

/**
 * A bcrypt comparison against a throwaway hash, run when the email doesn't exist.
 *
 * Without it, a missing account returns in ~1ms and a real one in ~250ms, which turns
 * the login endpoint into an account enumeration oracle — useful for deciding which
 * addresses are worth attacking.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.NoJp0AwZBK1eIYFtOfQMSlqzMNyBqPS'

export async function login({ email, password, context }) {
  // Branch populated so the login response names it — the dashboard header needs
  // "Sugarloop DHA Phase 1", not an id it has to resolve with a second request.
  const staffUser = await StaffUser.findOne({ email })
    .select('+passwordHash')
    .populate('branchId', 'code name')

  if (!staffUser) {
    await bcrypt.compare(password, DUMMY_HASH)
    throw ApiError.unauthorized('Invalid email or password')
  }

  if (staffUser.isLocked()) {
    throw new ApiError(
      423,
      'ACCOUNT_LOCKED',
      'Too many failed attempts. This account is locked for 15 minutes.'
    )
  }

  const passwordMatches = await staffUser.verifyPassword(password)

  if (!passwordMatches) {
    await staffUser.registerFailedLogin()
    // Same message either way. "No such user" versus "wrong password" is free
    // reconnaissance.
    throw ApiError.unauthorized('Invalid email or password')
  }

  // Checked after the password, on purpose: telling an unauthenticated caller that an
  // account exists but is disabled is the same enumeration leak in a friendlier tone.
  if (!staffUser.isActive) {
    throw ApiError.forbidden('This account has been deactivated')
  }

  await staffUser.registerSuccessfulLogin()

  const { accessToken, refreshToken } = await issueSession(staffUser, context)
  return { staffUser, accessToken, refreshToken }
}

/**
 * Rotate a refresh token.
 *
 * Every refresh burns the presented token and issues a new one. If a burnt token is
 * ever presented again, either it was stolen and replayed or the legitimate client is
 * retrying — and the two are indistinguishable from here, so the safe reading is theft:
 * every session for that account is revoked and everyone logs in again.
 */
export async function refresh({ refreshToken, context }) {
  if (!refreshToken) throw ApiError.unauthorized('Refresh token is required')

  const session = await StaffSession.findOne({ tokenHash: hashRefreshToken(refreshToken) })
  if (!session) throw ApiError.unauthorized('Invalid refresh token')

  if (session.revokedAt) {
    logger.error(
      { staffUserId: String(session.staffUserId), sessionId: String(session._id) },
      'Refresh token reuse detected — revoking all sessions for this account'
    )
    await revokeAllSessions(session.staffUserId)
    throw ApiError.unauthorized('Invalid refresh token')
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Refresh token has expired')
  }

  const staffUser = await StaffUser.findById(session.staffUserId).populate('branchId', 'code name')
  if (!staffUser || !staffUser.isActive) {
    await revokeAllSessions(session.staffUserId)
    throw ApiError.forbidden('This account has been deactivated')
  }

  const issued = await issueSession(staffUser, context)

  session.revokedAt = new Date()
  session.replacedBy = issued.session._id
  await session.save()

  return { staffUser, accessToken: issued.accessToken, refreshToken: issued.refreshToken }
}

/** Idempotent by design — logging out twice is not an error worth surfacing. */
export async function logout(refreshToken) {
  if (!refreshToken) return
  await StaffSession.updateOne(
    { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  )
}

export async function revokeAllSessions(staffUserId) {
  await StaffSession.updateMany(
    { staffUserId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  )
}
