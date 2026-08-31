import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  createBranchSchema,
  idParamSchema,
  updateBranchSchema,
} from '../validators/staffBranch.validator.js'
import * as staffBranchController from '../controllers/staffBranch.controller.js'

const router = Router()

/**
 * Signed in for everything here; the role gate differs per route, so it is applied per
 * route rather than at the router. The two verbs are not the same kind of act — opening a
 * shop is a decision, pausing one mid-rush is a shift.
 */
router.use(requireStaff)

/**
 * Every branch, closed ones included, with both raw switches.
 *
 * Distinct from the public `GET /branches` rather than duplicating it: that one hides
 * `isActive: false`, which is correct for a storefront and would make a closed branch
 * unreopenable from a console that could only ever see live ones. Both roles read it —
 * a manager's own branch state drives the pause control on their order board.
 */
router.get(
  '/',
  requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.BRANCH_MANAGER),
  asyncHandler(staffBranchController.list)
)

/**
 * Opens a branch. Admin only — a branch manager runs one shop, and a new branch changes
 * where every future delivery is quoted from.
 */
router.post(
  '/',
  requireRole(STAFF_ROLE.ADMIN),
  validate({ body: createBranchSchema }),
  asyncHandler(staffBranchController.create)
)

/**
 * The two switches. Both roles reach this route; the service decides which switch each
 * may flip and whose branch they may flip it on.
 *
 * A branch manager needs `acceptingOrders` — it is the control you press when the kitchen
 * is drowning, and routing that through an admin means the queue keeps growing while
 * somebody makes a phone call. `isActive` stays admin-only, and the service answers 403
 * to a manager who tries.
 *
 * There is deliberately no DELETE. Every order stores its branch, so removing the
 * document strands order history; `isActive: false` is what deleting a branch means here,
 * and it can be undone.
 */
router.patch(
  '/:id',
  requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.BRANCH_MANAGER),
  validate({ params: idParamSchema, body: updateBranchSchema }),
  asyncHandler(staffBranchController.update)
)

export default router
