import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { orderLimiter } from '../middleware/rateLimit.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  createOrderSchema,
  getOrderQuerySchema,
  orderNumberParamSchema,
} from '../validators/order.validator.js'
import * as orderController from '../controllers/order.controller.js'

const router = Router()

/**
 * Places an order.
 *
 * Rate limited harder than the rest of the API: each accepted order commits real kitchen
 * time and, on Cash on Delivery, a rider trip nobody has paid for. Ten a minute per IP is
 * generous for a person and useless for a script.
 *
 * ⚠️ Unauthenticated in Phase 1 — phone-OTP is Sprint 2. Until it lands, nothing verifies
 * that the phone number on an order belongs to whoever placed it, which is precisely the
 * gap that lets prank orders reach a real address. This endpoint should NOT be public
 * before OTP ships.
 */
router.post(
  '/',
  orderLimiter,
  validate({ body: createOrderSchema }),
  asyncHandler(orderController.create)
)

/**
 * One order, by number. Requires the phone it was placed with — order numbers are
 * sequential and enumerable, so this is what stops them being counted through. Replaced by
 * the OTP session in Sprint 2.
 */
router.get(
  '/:orderNumber',
  validate({ params: orderNumberParamSchema, query: getOrderQuerySchema }),
  asyncHandler(orderController.getByNumber)
)

export default router
