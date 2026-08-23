import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'
import { ApiError } from '../utils/ApiError.js'
import { env } from '../config/env.js'
import { getRedis } from '../config/redis.js'
import { logger } from '../config/logger.js'

const handler = (_req, _res, next) => {
  next(ApiError.tooManyRequests())
}

/**
 * Where the counters live.
 *
 * Redis when it is configured, and the library's in-memory store when it is not.
 *
 * The in-memory store is wrong in two ways that matter and one that does not. It resets
 * on every restart, so a deploy hands every attacker a fresh budget; and it is per
 * process, so two instances enforce double the limit each thinks it is enforcing. On
 * OTP that is not a performance detail — the per-IP cap IS the control that stops a
 * script walking a million six-digit codes, and the per-phone cap in the OTP service is
 * the only other thing standing there.
 *
 * What it does not affect is a single developer on a laptop, which is why it stays the
 * fallback rather than becoming a prerequisite. Outside development it warns.
 *
 * One prefix per limiter so the five do not share a bucket — without it a customer who
 * placed an order would have spent part of their OTP allowance.
 */
function storeFor(name) {
  const redis = getRedis()
  if (!redis) return undefined

  return new RedisStore({
    prefix: `rl:${name}:`,
    // rate-limit-redis speaks in raw commands so it can stay driver-agnostic; ioredis
    // takes the command name and its arguments separately.
    sendCommand: (...args) => redis.call(...args),
  })
}

if (!env.REDIS_URL && !env.isDevelopment) {
  logger.warn(
    'RATE LIMITS: REDIS_URL is not set, so limits are per-process and reset on restart. ' +
      'With more than one instance each enforces its own separate budget, and the OTP ' +
      'per-IP cap is a security control rather than a nicety.'
  )
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
}

/** Broad protection for the whole API. Generous — this is anti-runaway, not anti-abuse. */
export const generalLimiter = rateLimit({
  ...base,
  store: storeFor('general'),
  windowMs: 60_000,
  limit: 300,
})

/**
 * Order placement. Tighter, because each accepted order commits real kitchen time
 * and, on COD, a rider trip that nobody has paid for.
 */
export const orderLimiter = rateLimit({
  ...base,
  store: storeFor('order'),
  windowMs: 60_000,
  limit: 10,
})

/**
 * OTP request. The most abusable endpoint in the system — every call costs money in
 * WhatsApp or SMS fees, so an unthrottled endpoint is a direct line to the client's
 * balance. Per-phone limits are enforced separately in the OTP service; this is the
 * per-IP layer.
 *
 * **Raised in development, and only there.** Everyone testing locally shares one IP —
 * the developer, the browser, the Postman run and the test suite all arrive as
 * `127.0.0.1` — so ten an hour is exhausted in a single afternoon of work and then
 * blocks the person who has to demonstrate the flow. In production a real customer
 * verifies once every four days, so ten an hour from one address is already far more
 * than legitimate use needs, and the low number is the point.
 *
 * The per-phone cap (3/hour, in customerAuth.service.js) is deliberately NOT relaxed.
 * That is the limit protecting the client's bill and any individual person's handset
 * from being rung repeatedly, and it should behave identically everywhere so a
 * developer meets the same rule a customer will.
 */
export const otpLimiter = rateLimit({
  ...base,
  store: storeFor('otp'),
  windowMs: 60 * 60_000,
  limit: env.isDevelopment ? 200 : 10,
})

/**
 * Address lookup. Public, and the only public endpoint that can reach a **paid** API —
 * Google bills per geocode once past the monthly free tier, so an unthrottled loop here
 * spends the client's money rather than merely using their CPU.
 *
 * The cache absorbs repeats, so this limit only ever bites on a stream of DISTINCT
 * addresses, which is not a shape real checkout traffic has. Relaxed in development for
 * the same reason as the OTP limiter: everyone testing shares one localhost IP.
 */
export const geocodeLimiter = rateLimit({
  ...base,
  store: storeFor('geocode'),
  windowMs: 60 * 60_000,
  limit: env.isDevelopment ? 500 : 60,
})

/**
 * The corporate gifting form. Public, unauthenticated, and every submission sends an
 * email — so an unthrottled endpoint is a way to flood the shop's own inbox until the
 * real leads are unfindable, using the shop's own SMTP reputation to do it.
 *
 * Five an hour is far more than a company asking about gift boxes needs, and useless to
 * a script. Relaxed in development for the same reason as the OTP and geocode limiters:
 * the developer, the browser, Postman and the test suite all arrive as `127.0.0.1`.
 */
export const enquiryLimiter = rateLimit({
  ...base,
  store: storeFor('enquiry'),
  windowMs: 60 * 60_000,
  limit: env.isDevelopment ? 100 : 5,
})

/** Login. Slows credential stuffing against staff accounts. */
export const authLimiter = rateLimit({
  ...base,
  store: storeFor('auth'),
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
})
