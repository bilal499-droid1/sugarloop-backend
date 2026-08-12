import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  createStaffUserSchema,
  idParamSchema,
  listStaffUsersSchema,
  resetPasswordSchema,
  updateStaffUserSchema,
} from '../validators/staffUser.validator.js'
import * as staffUserController from '../controllers/staffUser.controller.js'

const router = Router()

// Applied at the router level rather than per route. A guard that has to be repeated
// on every line is a guard that will eventually be forgotten on one of them.
router.use(requireStaff, requireRole(STAFF_ROLE.ADMIN))

router.get('/', validate({ query: listStaffUsersSchema }), asyncHandler(staffUserController.list))

router.post('/', validate({ body: createStaffUserSchema }), asyncHandler(staffUserController.create))

router.get('/:id', validate({ params: idParamSchema }), asyncHandler(staffUserController.getOne))

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateStaffUserSchema }),
  asyncHandler(staffUserController.update)
)

router.post(
  '/:id/password',
  validate({ params: idParamSchema, body: resetPasswordSchema }),
  asyncHandler(staffUserController.resetPassword)
)

// Soft delete — the service deactivates rather than removing. See the service.
router.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(staffUserController.deactivate)
)

export default router
