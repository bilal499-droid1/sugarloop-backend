import { z } from 'zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

export const dailyReportSchema = z.object({
  /**
   * A local calendar date in Asia/Karachi. Omitted means today in business time — the
   * shop trades to 03:00, so a manager reading the report at 1am wants the day that
   * started yesterday morning, which is what the service defaults to.
   */
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date like 2026-08-13')
    .optional(),

  /** Accepted from an admin; a branch manager naming another branch is a 403 in the service. */
  branchId: objectId.optional(),
})

const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date like 2026-08-13')

/**
 * The running total. Both dates optional — omitting them means "since the shop opened",
 * which is the whole point of this endpoint.
 */
export const summaryReportSchema = z
  .object({
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    branchId: objectId.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['from'],
    // ISO dates sort lexicographically, so a string compare is a date compare here.
    message: 'The start date must not be after the end date',
  })
