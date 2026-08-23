import { Router } from 'express'
import { enquiryLimiter } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { createEnquirySchema } from '../validators/enquiry.validator.js'
import * as enquiryController from '../controllers/enquiry.controller.js'

const router = Router()

/**
 * Corporate gifting enquiry. Public — a company asking about gift boxes has no account
 * and should not need one to ask.
 *
 * Reading enquiries back is deliberately not here. `GET /staff/enquiries` and the inbox
 * screen that goes with it are their own piece of work; until then the notification email
 * is how anyone learns about a lead, and the stored row is what stops one being lost if
 * that email never arrives.
 */
router.post(
  '/',
  enquiryLimiter,
  validate({ body: createEnquirySchema }),
  asyncHandler(enquiryController.create)
)

export default router
