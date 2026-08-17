import { z } from 'zod'
import { FAILURE_REASON, FULFILMENT, ORDER_STATUS } from '../config/constants.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

/**
 * The board's phone search. Normalised to the same E.164 form the order was stored in,
 * so an operator can type what the customer told them rather than what the database
 * happens to hold. Deliberately looser than the one in order.validator.js — this filters
 * a list, it does not create a record, so a search that matches nothing is harmless.
 */
const phoneSearch = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => /^(\+92|92|0)3\d{9}$/.test(value), {
    message: 'Must be a Pakistani mobile number, e.g. 03001234567',
  })
  .transform((value) => `+92${value.replace(/^\+?92|^0/, '')}`)

export const idParamSchema = z.object({ id: objectId })

export const listOrdersSchema = z.object({
  status: z.enum(Object.values(ORDER_STATUS)).optional(),
  fulfilment: z.enum(Object.values(FULFILMENT)).optional(),

  /**
   * Accepted from an admin, ignored-then-403'd for a branch manager. The scope decision
   * is the service's, not this schema's — a validator that silently dropped the field
   * would make the rule invisible at the point it is enforced.
   */
  branchId: objectId.optional(),

  /** A local calendar date in Asia/Karachi — the kitchen's "today". */
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date like 2026-08-13')
    .optional(),

  phone: phoneSearch.optional(),

  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: objectId.optional(),
})

/**
 * A status change.
 *
 * The reason rules are checked here AND in `services/orderStatus.js`. Here so a bad
 * request fails at the edge with a field path the dashboard can highlight; there so the
 * rule still holds for callers that never pass through Express — Sprint 2's status
 * timers among them.
 */
export const changeStatusSchema = z
  .object({
    status: z.enum(Object.values(ORDER_STATUS)),
    reason: z.enum(Object.values(FAILURE_REASON)).nullish(),
    /** Free text for the trail — "customer called, wants it left with the guard". */
    note: z.string().trim().min(1).max(500).nullish(),
  })
  .superRefine((body, ctx) => {
    const failing = body.status === ORDER_STATUS.FAILED

    if (failing && !body.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: `Failing an order requires a reason: ${Object.values(FAILURE_REASON).join(', ')}`,
      })
    }

    if (!failing && body.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'A reason may only be given when failing an order',
      })
    }

    // `other` means "none of the codes fit", which is only useful if the person who
    // chose it says what did happen.
    if (failing && body.reason === FAILURE_REASON.OTHER && !body.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: "Reason 'other' requires a note explaining what happened",
      })
    }
  })
