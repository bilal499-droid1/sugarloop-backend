import { Router } from 'express'
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
/**
 * ⚠️ No per-form rate limit, by request.
 *
 * `generalLimiter` still applies to the whole API at 300/minute per IP, so this is not
 * unbounded — but it is now roughly sixty times more permissive than the five an hour
 * this endpoint used to allow, and that gap is worth understanding rather than
 * discovering.
 *
 * This form is public, unauthenticated, and every accepted submission sends an email from
 * the shop's own account. What the tight limit was protecting against is a script filling
 * the shop's inbox until the real leads are unfindable — using the shop's own SMTP
 * reputation to do it, which is the part that is slow to undo: mail providers throttle a
 * sender that suddenly emits hundreds of messages, and Gmail in particular is quick to
 * start dropping mail from an account it has begun to distrust.
 *
 * It matters less today than it will: `EMAIL_TRANSPORT=log` sends nothing, so a flood
 * currently costs database rows and console noise. It matters on the day SMTP is switched
 * on. Restoring it is one line — `enquiryLimiter` is still exported and still configured.
 */
router.post(
  '/',
  validate({ body: createEnquirySchema }),
  asyncHandler(enquiryController.create)
)

export default router
