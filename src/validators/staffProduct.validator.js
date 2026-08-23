import { z } from 'zod'
import { PRODUCT_CATEGORIES } from '../config/constants.js'

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
