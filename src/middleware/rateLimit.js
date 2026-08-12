import rateLimit from 'express-rate-limit'
import { ApiError } from '../utils/ApiError.js'

// In-memory store for now. When the API runs on more than one Render instance this
// must move to Redis, or each instance enforces its own separate limit.
// TODO(sprint-2): swap for rate-limit-redis alongside the BullMQ Redis instance.

const handler = (_req, _res, next) => {
  next(ApiError.tooManyRequests())
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
}

/** Broad protection for the whole API. Generous — this is anti-runaway, not anti-abuse. */
export const generalLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 300,
})

/**
 * Order placement. Tighter, because each accepted order commits real kitchen time
 * and, on COD, a rider trip that nobody has paid for.
 */
export const orderLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 10,
})

/**
 * OTP request. The most abusable endpoint in the system — every call costs money in
 * WhatsApp or SMS fees, so an unthrottled endpoint is a direct line to the client's
 * balance. Per-phone limits are enforced separately in the OTP service; this is the
 * per-IP layer.
 */
export const otpLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 10,
})

/** Login. Slows credential stuffing against staff accounts. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
})
