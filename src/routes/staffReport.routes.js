import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { dailyReportSchema, summaryReportSchema } from '../validators/staffReport.validator.js'
import * as staffReportController from '../controllers/staffReport.controller.js'

const router = Router()

/**
 * Both roles read a report; the service decides whose numbers they get. A branch manager
 * needs their own day's takings to run a shift, and pinning them to their own branch is
 * the same rule the order board already applies.
 */
router.use(requireStaff, requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.BRANCH_MANAGER))

router.get(
  '/daily',
  validate({ query: dailyReportSchema }),
  asyncHandler(staffReportController.daily)
)

/**
 * The same report as a document. A separate path rather than an `Accept` header or a
 * `?format=pdf` flag: this is a link a manager clicks in the console, and a URL that
 * downloads a file should look like one.
 */
router.get(
  '/daily.pdf',
  validate({ query: dailyReportSchema }),
  asyncHandler(staffReportController.dailyPdf)
)

/**
 * The running total. With no `from`/`to` this is everything the shop has ever taken —
 * the question "what have we made so far" asked directly, rather than by loading one day
 * at a time and adding them up by hand.
 */
router.get(
  '/summary',
  validate({ query: summaryReportSchema }),
  asyncHandler(staffReportController.summary)
)

router.get(
  '/summary.pdf',
  validate({ query: summaryReportSchema }),
  asyncHandler(staffReportController.summaryPdf)
)

export default router
