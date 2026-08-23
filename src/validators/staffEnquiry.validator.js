import { z } from 'zod'
import { ENQUIRY_STATUS } from '../config/constants.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

export const idParamSchema = z.object({ id: objectId })

export const listEnquiriesSchema = z.object({
  status: z.enum(Object.values(ENQUIRY_STATUS)).optional(),

  /**
   * `?emailed=false` finds the leads nobody has been told about — the ones whose
   * notification email failed, which are invisible to anyone working from the inbox
   * alone. That is the single most useful filter on this screen and the reason the
   * `emailedAt` timestamp is stored rather than just logged.
   */
  emailed: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),

  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: objectId.optional(),
})

/**
 * Moving a lead along, and saying what was done.
 *
 * Both fields are optional individually but at least one must be present — an empty
 * PATCH is almost always a client bug, and answering 200 to it reports a change that
 * never happened.
 */
export const updateEnquirySchema = z
  .object({
    status: z.enum(Object.values(ENQUIRY_STATUS)),
    note: z.string().trim().min(1, 'A note cannot be empty').max(2000),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide a status, a note, or both',
  })
