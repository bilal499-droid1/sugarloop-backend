import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  branchCodeParamSchema,
  listBranchesSchema,
} from '../validators/catalogue.validator.js'
import * as catalogueController from '../controllers/catalogue.controller.js'

const router = Router()

router.get(
  '/',
  validate({ query: listBranchesSchema }),
  asyncHandler(catalogueController.listBranches)
)

// Step 9 mounts nearest-branch resolution here:
//   router.post('/resolve', ...)   // needs real coordinates and a Maps key

router.get(
  '/:code',
  validate({ params: branchCodeParamSchema }),
  asyncHandler(catalogueController.getBranch)
)

export default router
