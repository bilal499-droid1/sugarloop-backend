import { Router } from 'express'
import { STAFF_ROLE } from '../config/constants.js'
import { validate } from '../middleware/validate.js'
import { requireStaff, requireRole } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  attachImageSchema,
  createProductSchema,
  idParamSchema,
  imageUploadUrlSchema,
  listStaffProductsSchema,
  removeImageSchema,
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

/* ─── Product photos ──────────────────────────────────────────────────────────
 *
 * Three steps, because the file itself never comes through this API:
 *
 *   POST /:id/images/upload-url  → { uploadUrl, key, url, expiresIn }
 *   PUT  <uploadUrl>             → the browser sends the file straight to S3
 *   POST /:id/images  { key }    → verified and recorded on the product
 *
 * The middle step is not ours. `app.js` caps request bodies at 100kb, so a photo cannot
 * be POSTed here — and should not be, since it would put every megabyte through EC2
 * memory. See services/staffProduct.service.js for why step 3 trusts nothing it is told.
 */

router.post(
  '/:id/images/upload-url',
  validate({ params: idParamSchema, body: imageUploadUrlSchema }),
  asyncHandler(staffProductController.createImageUpload)
)

router.post(
  '/:id/images',
  validate({ params: idParamSchema, body: attachImageSchema }),
  asyncHandler(staffProductController.attachImage)
)

/**
 * Deletes the photo for real — both the row and the object. Unlike a product, an image
 * has no history to protect: an order line snapshots the name and price it was bought
 * at, never the picture.
 *
 * The key travels in the body because an S3 key contains slashes, and a path parameter
 * carrying one has to survive double-encoding by every client and correct decoding by
 * every proxy in front of this.
 */
router.delete(
  '/:id/images',
  validate({ params: idParamSchema, body: removeImageSchema }),
  asyncHandler(staffProductController.removeImage)
)

export default router
