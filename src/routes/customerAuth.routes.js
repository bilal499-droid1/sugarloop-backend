import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { otpLimiter } from '../middleware/rateLimit.js'
import { requireCustomer } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { requestOtpSchema, verifyOtpSchema } from '../validators/customerAuth.validator.js'
import * as customerAuthController from '../controllers/customerAuth.controller.js'

const router = Router()

/**
 * Sends a verification code.
 *
 * The most expensive endpoint in the system to abuse: every call bills a WhatsApp or SMS
 * message. `otpLimiter` is the per-IP layer (10/hour); the per-phone cap (3/hour) and the
 * resend cooldown live in the service, because an attacker rotating IPs would sail past
 * an IP limit alone while still ringing one victim's phone.
 */
router.post(
  '/otp/request',
  otpLimiter,
  validate({ body: requestOtpSchema }),
  asyncHandler(customerAuthController.requestOtp)
)

/**
 * Exchanges a code for a session.
 *
 * Also rate limited: without it, six digits is a million guesses that a script would walk
 * in minutes. The per-challenge attempt limit is the real defence, but it only protects
 * one challenge at a time — this bounds the whole endpoint.
 */
router.post(
  '/otp/verify',
  otpLimiter,
  validate({ body: verifyOtpSchema }),
  asyncHandler(customerAuthController.verifyOtp)
)

/** Whether this browser still holds a valid session, and for which number. */
router.get('/me', requireCustomer, asyncHandler(customerAuthController.me))

router.post('/logout', asyncHandler(customerAuthController.logout))

export default router
