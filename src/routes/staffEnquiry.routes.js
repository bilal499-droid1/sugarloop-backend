import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  idParamSchema,
  listEnquiriesSchema,
  updateEnquirySchema,
} from '../validators/staffEnquiry.validator.js'
import * as staffEnquiryController from '../controllers/staffEnquiry.controller.js'

const router = Router()

/**
 * Admin only, applied at the router rather than per route — a guard that has to be
 * repeated on every line is a guard that will eventually be forgotten on one of them.
 *
 * Branch managers are excluded deliberately: a corporate gifting lead is not a branch's
 * order. It carries a company's contact details and belongs to whoever runs the shop,
 * not to whichever kitchen happens to be nearest.
 */
router.use(requireStaff, requireRole(STAFF_ROLE.ADMIN))

router.get('/', validate({ query: listEnquiriesSchema }), asyncHandler(staffEnquiryController.list))

// Before `/:id`, or Express matches "summary" as an id and the param validator 422s it.
router.get('/summary', asyncHandler(staffEnquiryController.summary))

router.get('/:id', validate({ params: idParamSchema }), asyncHandler(staffEnquiryController.getOne))

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateEnquirySchema }),
  asyncHandler(staffEnquiryController.update)
)

// No POST and no DELETE, deliberately. Leads arrive from the public form; removing one
// would erase the evidence that a company ever asked.

export default router
