import { z } from 'zod'
import { PRODUCT_CATEGORIES } from '../config/constants.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

/** Matches the Product model's slug rule, so a bad slug 404s instead of hitting Mongo. */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase hyphenated slug')
  .max(140)

export const productSlugParamSchema = z.object({ slug })

export const listProductsSchema = z.object({
  category: z.enum(PRODUCT_CATEGORIES).optional(),

  /** Menu sub-heading — 'Signature', 'Iced Coffee'. Free text on the model, so free here. */
  type: z.string().trim().min(1).max(60).optional(),

  /**
   * When present, every product comes back carrying `inStock` for THAT branch.
   * Without it there is no such thing as a correct stock answer, so the field is omitted
   * entirely rather than guessed — see catalogue.service.js.
   */
  branchId: objectId.optional(),

  boxEligible: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),

  /**
   * The catalogue is 43 items and the storefront renders all of them at once to build its
   * category tabs, so this is a sanity bound rather than real pagination. If the menu ever
   * outgrows one response, that is the moment to add a cursor — not before.
   */
  limit: z.coerce.number().int().min(1).max(200).default(200),
})

/** Single product, optionally answered for one branch. */
export const getProductSchema = z.object({ branchId: objectId.optional() })

export const listBranchesSchema = z.object({
  fulfilment: z.enum(['delivery', 'pickup']).optional(),
})

export const branchCodeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Must be a branch code like DHA2'),
})
