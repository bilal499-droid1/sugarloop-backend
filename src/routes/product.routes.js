import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  getProductSchema,
  listProductsSchema,
  productSlugParamSchema,
} from '../validators/catalogue.validator.js'
import * as catalogueController from '../controllers/catalogue.controller.js'

const router = Router()

// Public and unauthenticated — this is the menu. Only the general rate limiter applies.
router.get(
  '/',
  validate({ query: listProductsSchema }),
  asyncHandler(catalogueController.listProducts)
)

router.get(
  '/:slug',
  validate({ params: productSlugParamSchema, query: getProductSchema }),
  asyncHandler(catalogueController.getProduct)
)

export default router
