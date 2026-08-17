/**
 * Customer identity: prove you hold the phone, get a session.
 *
 * There is no password and no signup. The phone number IS the account, and a six-digit
 * code proves it belongs to whoever is checking out. That is the only thing standing
 * between the client and prank Cash-on-Delivery orders to fake addresses — an order
 * nobody intends to accept still costs a rider trip and the food.
 *
 * Two rules shape everything here:
 *
 * 1. **A code is a credential.** Never stored in plaintext, never returned to the caller
 *    (except by the development transport, which is refused in production), never
 *    reusable, and dead after five wrong guesses.
 * 2. **Every request costs money.** WhatsApp and SMS bill per message, so an unthrottled
 *    endpoint is a direct line to the client's balance. Limits are enforced per phone
 *    here and per IP in middleware.
 */
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { OTP } from '../config/constants.js'
import { ApiError } from '../utils/ApiError.js'
import { OtpChallenge } from '../models/OtpChallenge.js'
import { deliverOtp, mayEchoCode } from './otpDelivery.service.js'

const ISSUER = 'sugarloop'

/**
 * A different audience AND a different secret from staff tokens (see config/env.js,
 * which refuses to start if the two secrets match). A customer token must never be
 * accepted on a staff route — that would turn "I verified my phone" into an order board.
 */
const AUDIENCE = 'sugarloop-customer'
const TOKEN_TYPE = 'customer_session'

/**
 * `crypto.randomInt`, not `Math.random`.
 *
 * `Math.random` is a predictable PRNG — given a few outputs its internal state can be
 * recovered and every subsequent "code" derived. For anything a person's identity rests
 * on, the generator has to be the cryptographic one.
 */
function generateCode() {
  const max = 10 ** OTP.LENGTH
  return String(crypto.randomInt(0, max)).padStart(OTP.LENGTH, '0')
}

export function signCustomerToken(phone) {
  return jwt.sign({ typ: TOKEN_TYPE, phone }, env.JWT_CUSTOMER_SECRET, {
    subject: phone,
    expiresIn: env.JWT_CUSTOMER_EXPIRES_IN,
    issuer: ISSUER,
    audience: AUDIENCE,
  })
}

export function verifyCustomerToken(token) {
  let payload
  try {
    payload = jwt.verify(token, env.JWT_CUSTOMER_SECRET, { issuer: ISSUER, audience: AUDIENCE })
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(
        401,
        'SESSION_EXPIRED',
        'Your verification has expired. Please verify your number again.'
      )
    }
    throw ApiError.unauthorized('Invalid session')
  }

  // Belt and braces alongside the audience check: a token minted for any other purpose
  // with this secret must not pass as a customer session.
  if (payload.typ !== TOKEN_TYPE || !payload.phone) {
    throw ApiError.unauthorized('Invalid session')
  }

  return payload
}

/**
 * Sends a code to a phone.
 *
 * Note what is NOT checked: whether this phone has ordered before. There is no account to
 * enumerate, so there is nothing to leak by accepting any well-formed number.
 */
export async function requestOtp({ phone, ip = '' }, { now = new Date() } = {}) {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const recent = await OtpChallenge.find({ phone, createdAt: { $gte: hourAgo } })
    .sort({ createdAt: -1 })
    .limit(OTP.MAX_PER_PHONE_PER_HOUR)

  /**
   * Cooldown before the per-hour cap, so the common case — an impatient double-tap on
   * "resend" — gets "wait 40 seconds" rather than silently spending one of only three
   * hourly messages.
   */
  const last = recent[0]
  if (last) {
    const elapsed = (now - last.createdAt) / 1000
    if (elapsed < OTP.RESEND_COOLDOWN_SECONDS) {
      throw new ApiError(429, 'OTP_COOLDOWN', 'Please wait before requesting another code', {
        retryAfterSeconds: Math.ceil(OTP.RESEND_COOLDOWN_SECONDS - elapsed),
      })
    }
  }

  if (recent.length >= OTP.MAX_PER_PHONE_PER_HOUR) {
    // Oldest of the ones counted against the cap — when it ages out, a slot frees.
    const oldest = recent[recent.length - 1]
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest.createdAt.getTime() + 60 * 60 * 1000 - now.getTime()) / 1000)
    )

    throw new ApiError(
      429,
      'OTP_RATE_LIMITED',
      'Too many codes requested for this number. Please try again later.',
      { retryAfterSeconds }
    )
  }

  const code = generateCode()

  const challenge = await OtpChallenge.create({
    phone,
    codeHash: await OtpChallenge.hashCode(code),
    expiresAt: new Date(now.getTime() + OTP.TTL_MINUTES * 60 * 1000),
    ip,
  })

  /**
   * Delivery failure deletes the challenge.
   *
   * Otherwise a WhatsApp outage would burn one of the customer's three hourly attempts
   * on a code they never received — and after three, they cannot order at all.
   */
  try {
    await deliverOtp({ phone, code })
  } catch (error) {
    await OtpChallenge.deleteOne({ _id: challenge._id })
    throw error
  }

  return {
    expiresAt: challenge.expiresAt,
    expiresInSeconds: OTP.TTL_MINUTES * 60,
    resendInSeconds: OTP.RESEND_COOLDOWN_SECONDS,
    /**
     * Returned ONLY when nothing actually delivered it — the development `log`
     * transport, outside production. Without this there is no way to complete a checkout
     * on a machine with no WhatsApp account, which would make the whole flow untestable.
     */
    ...(mayEchoCode() ? { devCode: code } : {}),
  }
}

/**
 * Checks a code and issues a session.
 *
 * Every failure mode returns the same `OTP_INVALID` code and a deliberately unspecific
 * message. Distinguishing "no code was requested" from "wrong code" from "expired" would
 * tell an attacker which numbers are mid-checkout and which guesses are getting closer.
 * The one exception is running out of attempts, which the customer genuinely needs to
 * know about — otherwise they retype the same code forever against a dead challenge.
 */
export async function verifyOtp({ phone, code }, { now = new Date() } = {}) {
  const challenge = await OtpChallenge.findOne({ phone }).sort({ createdAt: -1 })

  const reject = () => {
    throw new ApiError(401, 'OTP_INVALID', 'That code is not valid. Please check and try again.')
  }

  if (!challenge) reject()

  if (challenge.attempts >= challenge.maxAttempts) {
    throw new ApiError(
      429,
      'OTP_ATTEMPTS_EXHAUSTED',
      'Too many incorrect attempts. Please request a new code.'
    )
  }

  if (!challenge.isUsable(now)) reject()

  const matched = await challenge.matches(code)

  if (!matched) {
    // Recorded before the throw, or a wrong guess would cost nothing and the limit
    // would never bite.
    challenge.attempts += 1
    await challenge.save()

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new ApiError(
        429,
        'OTP_ATTEMPTS_EXHAUSTED',
        'Too many incorrect attempts. Please request a new code.'
      )
    }

    throw new ApiError(401, 'OTP_INVALID', 'That code is not valid. Please check and try again.', {
      attemptsRemaining: challenge.maxAttempts - challenge.attempts,
    })
  }

  // Burned on success. A code that verified once must never verify again.
  challenge.consumedAt = now
  await challenge.save()

  return { phone, token: signCustomerToken(phone), expiresIn: env.JWT_CUSTOMER_EXPIRES_IN }
}
