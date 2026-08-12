import { z } from 'zod'
import { quoteSchema } from './checkout.validator.js'

/**
 * Pakistani mobile number, normalised to E.164.
 *
 * Accepts what people actually type — `03001234567`, `+92 300 1234567`, `0300-1234567` —
 * and stores one canonical form, because this string is the only handle on a COD customer
 * and staff will search by it.
 */
const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => /^(\+92|92|0)3\d{9}$/.test(value), {
    message: 'Must be a Pakistani mobile number, e.g. 03001234567',
  })
  .transform((value) => {
    const digits = value.replace(/^\+?92|^0/, '')
    return `+92${digits}`
  })

const contact = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone,
  email: z.string().trim().toLowerCase().email().optional().nullable(),
})

const address = z.object({
  line1: z.string().trim().min(5, 'A street address is required').max(300),
  area: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).default('Islamabad'),
  /** Free text for the rider — "blue gate", "call on arrival". */
  notes: z.string().trim().max(500).optional(),
})

/**
 * Placing an order is a quote plus who it is for.
 *
 * It reuses the quote schema wholesale, so the cart cannot be shaped differently at order
 * time than it was at quote time — and, as there, a `price` sent by the client is stripped
 * before anything reads it.
 */
export const createOrderSchema = quoteSchema
  .innerType()
  .extend({
    contact,

    /** Required for delivery, ignored for pickup. Checked below. */
    address: address.optional(),

    /**
     * The grand total the customer was shown by `POST /checkout/quote`.
     *
     * Required, not optional. The server re-prices regardless, but without this there is
     * nothing to compare against and a cart whose price moved would go through silently at
     * the new number. Making it mandatory also forces the quote step, which is where every
     * other gate — stock, hours, minimum, radius — was already run.
     */
    expectedTotal: z.coerce.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    if (value.fulfilment === 'delivery') {
      if (!value.location) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['location'],
          message: 'Delivery requires location { lat, lng }',
        })
      }
      if (!value.address) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['address'],
          message: 'Delivery requires an address — a rider cannot deliver to coordinates alone',
        })
      }
    }

    if (value.fulfilment === 'pickup' && !value.branchId && !value.branchCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchCode'],
        message: 'Pickup requires branchId or branchCode — the customer chooses the branch',
      })
    }
  })

export const orderNumberParamSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^SL-\d{6}-\d{4,}$/, 'Must be an order number like SL-260810-0042'),
})

/** Looking up your own order while there is no customer login. See order.service.js. */
export const getOrderQuerySchema = z.object({ phone })
