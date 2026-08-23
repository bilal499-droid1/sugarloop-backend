import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import { requireStaff } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
} from '../validators/staffAuth.validator.js'
import * as staffAuthController from '../controllers/staffAuth.controller.js'

const router = Router()

// authLimiter skips successful requests, so a working dashboard is never throttled
// while a password-guessing loop still runs out of attempts.
router.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(staffAuthController.login)
)

// Also rate limited: refresh is unauthenticated by nature — the token is the only
// credential — so it is a guessing target like login is.
router.post(
  '/refresh',
  authLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(staffAuthController.refresh)
)

router.post('/logout', validate({ body: logoutSchema }), asyncHandler(staffAuthController.logout))

router.post('/logout-all', requireStaff, asyncHandler(staffAuthController.logoutAll))

/**
 * Rate limited despite being authenticated. The body carries the current password, so
 * this endpoint can be used to GUESS it — and whoever is guessing is already holding a
 * valid access token, which is the scenario where getting it right matters most. The
 * limiter skips successful requests, so nobody rotating their own password ever meets it.
 *
 * `requireStaff` first so an unauthenticated caller is turned away at the door rather
 * than spending a signed-in operator's share of the limit.
 */
router.post(
  '/password',
  requireStaff,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(staffAuthController.changePassword)
)

router.get('/me', requireStaff, asyncHandler(staffAuthController.me))

export default router
