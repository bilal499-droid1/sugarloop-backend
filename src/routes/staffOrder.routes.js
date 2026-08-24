import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  changeStatusSchema,
  idParamSchema,
  listOrdersSchema,
} from '../validators/staffOrder.validator.js'
import * as staffOrderController from '../controllers/staffOrder.controller.js'

const router = Router()

/**
 * Both roles work the order board — that is the branch manager's job. What differs is
 * scope, and scope is decided in the service from the token, never from the query the
 * client sent. Applied at the router level so a route added later cannot miss it.
 */
router.use(requireStaff, requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.BRANCH_MANAGER))

router.get('/', validate({ query: listOrdersSchema }), asyncHandler(staffOrderController.list))

router.get('/:id', validate({ params: idParamSchema }), asyncHandler(staffOrderController.getOne))

router.get(
  '/:id/invoice',
  validate({ params: idParamSchema }),
  asyncHandler(staffOrderController.invoice)
)

/**
 * Moves an order through the state machine. PATCH rather than a verb-per-transition
 * (`/confirm`, `/dispatch`): the legal moves are data in `ORDER_STATUS_FLOW`, and seven
 * endpoints that each hard-code one of them is the same table written twice.
 */
router.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: changeStatusSchema }),
  asyncHandler(staffOrderController.changeStatus)
)

export default router
