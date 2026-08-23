import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  createProductSchema,
  idParamSchema,
  listStaffProductsSchema,
  updateProductSchema,
} from '../validators/staffProduct.validator.js'
import * as staffProductController from '../controllers/staffProduct.controller.js'

const router = Router()

/**
 * Admin only, applied at the router rather than per route — a guard repeated on every
 * line is one that eventually gets forgotten on a line.
 *
 * A branch manager has no write here at all, and that is the rule the pricing engine is
 * built on: one global price list, with only availability varying per branch. A manager
 * who could edit a price could quietly undercut the other three shops.
 */
router.use(requireStaff, requireRole(STAFF_ROLE.ADMIN))

router.get(
  '/',
  validate({ query: listStaffProductsSchema }),
  asyncHandler(staffProductController.list)
)

router.post(
  '/',
  validate({ body: createProductSchema }),
  asyncHandler(staffProductController.create)
)

router.get('/:id', validate({ params: idParamSchema }), asyncHandler(staffProductController.getOne))

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateProductSchema }),
  asyncHandler(staffProductController.update)
)

/**
 * Discontinues. The service sets `isActive: false` and never removes the document —
 * every order line references a product, and an order whose lines cannot resolve one is
 * an order nobody can reprint or dispute. Reversed by PATCHing `isActive` back to true.
 */
router.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(staffProductController.remove)
)

export default router
