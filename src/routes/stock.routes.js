import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  listStockSchema,
  productIdParamSchema,
  setStockSchema,
} from '../validators/stock.validator.js'
import * as stockController from '../controllers/stock.controller.js'

const router = Router()

// A branch manager's only write. Scoped to their own branch in the service.
router.use(requireStaff, requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.BRANCH_MANAGER))

router.get('/', validate({ query: listStockSchema }), asyncHandler(stockController.list))

/**
 * Keyed by productId, not by a BranchStock row id: the row may not exist yet, and the
 * manager marking a tray empty knows what the product is, not what its stock record is
 * called. The service upserts.
 */
router.patch(
  '/:productId',
  validate({ params: productIdParamSchema, body: setStockSchema }),
  asyncHandler(stockController.setStock)
)

export default router
