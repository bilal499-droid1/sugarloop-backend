import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { quoteSchema } from '../validators/checkout.validator.js'
import * as checkoutController from '../controllers/checkout.controller.js'

const router = Router()

/**
 * Prices a cart without committing to anything. Public and unauthenticated — a customer
 * has not verified their phone at this point in the flow, and refusing to show a total
 * until they do would put the OTP step before the price.
 *
 * `POST` rather than `GET` because the cart goes in the body: a twelve-item box does not
 * belong in a query string, and this must not be cached.
 */
router.post('/quote', validate({ body: quoteSchema }), asyncHandler(checkoutController.quote))

export default router
