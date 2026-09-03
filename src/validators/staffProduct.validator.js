import { z } from 'zod'
import { PRODUCT_CATEGORIES } from '../config/constants.js'
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '../services/imageStorage.service.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

export const idParamSchema = z.object({ id: objectId })

/**
 * PKR in the stored form used everywhere in this system: whole hundredths of a rupee,
 * so Rs 299 is `29900`.
 *
 * The integer check is the important one and the message says the conversion out loud,
 * because the mistake this guards against is not a typo — it is an admin (or a client
 * developer) sending `299` and meaning Rs 299. That is a real price of Rs 2.99, it would
 * be accepted silently by a plain number check, and the first anyone would know is an
 * order priced at nothing. A float is rejected for the same reason `utils/money.js`
 * exists: 0.1 + 0.2 is not 0.3, and a rounding error in a price is a rounding error in
 * somebody's bill.
 */
const price = z
  .number({ invalid_type_error: 'Price must be a number of paisa — Rs 299 is 29900' })
  .int('Price must be a whole number of paisa — Rs 299 is 29900, not 299 or 299.00')
  .min(0, 'Price cannot be negative')

/** Lowercase words separated by single hyphens, matching the model. */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens')

const sku = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(60)
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'SKU must be uppercase segments separated by hyphens')

export const listStaffProductsSchema = z.object({
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  boxEligible: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),

  /**
   * Unlike the public catalogue, this list shows discontinued items by default.
   * They are the ones an admin most often needs to find — to bring one back, or to
   * check why it stopped appearing on the site.
   */
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),

  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: objectId.optional(),
})

/**
 * Creating a product.
 *
 * `slug` is optional and derived from the name when omitted — an admin naming a new
 * donut should not have to know what a URL slug is. `sku` is NOT derived: it is what
 * Nimbus POS will map against in Phase 2, and a generated one that later has to change
 * is worse than being asked for it now.
 *
 * `legacyId` is deliberately absent and cannot be set. It exists solely to map the 43
 * seeded products onto the numeric ids the live site keys its localStorage carts by;
 * a product created today never had one, and letting an admin invent one would collide
 * with a real cart.
 */
export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'A product needs a name').max(120),
  sku,
  slug: slug.optional(),
  category: z.enum(PRODUCT_CATEGORIES),
  type: z.string().trim().max(60).optional().default(''),
  price,
  description: z.string().trim().max(2000).optional().default(''),
  allergens: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
  boxEligible: z.boolean().optional().default(false),
  isFeatured: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(100),
})

/**
 * Editing one. Every field optional, but an empty body is rejected: it is almost always
 * a client bug, and answering 200 to it reports a change that never happened.
 *
 * `sku` is not editable. It is the key a POS integration maps against, and changing it
 * silently re-points that mapping at a different item.
 *
 * `isActive` is here so a discontinued product can be brought back without a second
 * endpoint — DELETE sets it false, this can set it true again.
 */
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug,
    category: z.enum(PRODUCT_CATEGORIES),
    type: z.string().trim().max(60),
    price,
    description: z.string().trim().max(2000),
    allergens: z.array(z.string().trim().min(1).max(60)).max(20),
    boxEligible: z.boolean(),
    isFeatured: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to change — send at least one field',
  })

/**
 * Asking for somewhere to put a photo.
 *
 * `size` is required and is not a formality. It is signed into the upload URL, so S3
 * rejects a PUT whose body is a different length — which is what keeps a URL issued for
 * a 200 KB photo from being spent on a 2 GB file. The frontend has the number for free
 * from `File.size`; it must send that exact value and then upload that exact file.
 *
 * `contentType` is a closed list rather than a pattern, and SVG is not on it. See
 * `imageStorage.service.js` — an SVG can carry script and would be served from the
 * domain the storefront trusts.
 */
export const imageUploadUrlSchema = z.object({
  filename: z.string().trim().min(1, 'A filename is required').max(200),
  contentType: z.enum(Object.keys(ALLOWED_IMAGE_TYPES), {
    errorMap: () => ({
      message: `Images must be one of: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')}`,
    }),
  }),
  size: z
    .number({ invalid_type_error: 'Send the file size in bytes' })
    .int()
    .positive('An empty file is not an image')
    .max(MAX_IMAGE_BYTES, `Images must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller`),
})

/**
 * Confirming the upload landed.
 *
 * `key` comes back from the upload-url call and is checked against this product's prefix
 * in the service — it is client input, and the only thing standing between it and
 * another product's photos.
 *
 * `alt` is optional and defaults to the product name in the service. Requiring it here
 * would mean an admin adding a photo has to write accessibility copy before the upload
 * is allowed to finish, and the answer they would type is the product name anyway.
 */
export const attachImageSchema = z.object({
  key: z.string().trim().min(1, 'Which upload? Send the key from the upload-url response').max(500),
  alt: z.string().trim().max(200).optional().default(''),
})

/**
 * Removing one. The key travels in the body rather than the path because an S3 key
 * contains slashes, and a path parameter carrying `products/<id>/ab12-front.webp` has to
 * be double-encoded by every client and correctly decoded by every proxy to survive.
 */
export const removeImageSchema = z.object({
  key: z.string().trim().min(1, 'Which image? Send its publicId').max(500),
})
