import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { geocodeLimiter } from '../middleware/rateLimit.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  branchCodeParamSchema,
  listBranchesSchema,
  resolveBranchSchema,
} from '../validators/catalogue.validator.js'
import * as catalogueController from '../controllers/catalogue.controller.js'

const router = Router()

router.get(
  '/',
  validate({ query: listBranchesSchema }),
  asyncHandler(catalogueController.listBranches)
)

/**
 * Nearest deliverable branch for a place.
 *
 * `POST` rather than `GET` because a customer's home address must not end up in a URL —
 * query strings are logged by proxies, kept in browser history, and leaked in referrers.
 *
 * Rate limited on its own: an address lookup can reach a paid geocoder, so this is the
 * one public endpoint where a loop costs the client money per call. Registered BEFORE
 * `/:code`, or Express would match "resolve" as a branch code.
 */
router.post(
  '/resolve',
  geocodeLimiter,
  validate({ body: resolveBranchSchema }),
  asyncHandler(catalogueController.resolveBranch)
)

router.get(
  '/:code',
  validate({ params: branchCodeParamSchema }),
  asyncHandler(catalogueController.getBranch)
)

export default router
