import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { createBranchSchema } from '../validators/staffBranch.validator.js'
import * as staffBranchController from '../controllers/staffBranch.controller.js'

const router = Router()

/**
 * Admin only, applied at the router. A branch manager runs one shop; opening another is
 * not a shift decision, and a new branch changes where every future delivery is quoted
 * from.
 */
router.use(requireStaff, requireRole(STAFF_ROLE.ADMIN))

/**
 * Opens a branch. Reading them back is the public `GET /branches`, which the staff console
 * already uses for its branch pickers — a list of shops is not a secret, and a second
 * authenticated route returning the same four rows would be two things to keep in step.
 */
router.post('/', validate({ body: createBranchSchema }), asyncHandler(staffBranchController.create))

export default router
