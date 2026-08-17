import { z } from 'zod'
import { PRODUCT_CATEGORIES } from '../config/constants.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

export const productIdParamSchema = z.object({ productId: objectId })

export const listStockSchema = z.object({
  /** Required for an admin, refused for a branch manager naming someone else's. */
  branchId: objectId.optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  /** `?inStock=false` is the dashboard's default view: what is sold out right now. */
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export const setStockSchema = z.object({
  /**
   * Required, not optional, and not a toggle verb.
   *
   * `PATCH { inStock: false }` is idempotent — a retried request, a double-tap on a
   * phone in a hot kitchen, or two managers acting at once all converge on the same
   * state. A `/toggle` endpoint that flips whatever it finds does not: two clicks that
   * race leave the tray marked available.
   */
  inStock: z.boolean(),
  branchId: objectId.optional(),
})
