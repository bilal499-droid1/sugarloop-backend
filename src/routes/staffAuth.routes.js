import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import { requireStaff } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { loginSchema, logoutSchema, refreshSchema } from '../validators/staffAuth.validator.js'
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

router.get('/me', requireStaff, asyncHandler(staffAuthController.me))

export default router
