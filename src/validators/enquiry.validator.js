import { z } from 'zod'

/**
 * Corporate gifting form.
 *
 * Only three fields are genuinely required: who you are, and two ways to reach you.
 * Everything else is optional because a lead is worth more than a complete form — a
 * company that types a name, a number and "need 200 boxes for Eid" should not be argued
 * with about which box they left empty.
 */

/**
 * Deliberately NOT the Pakistani-mobile rule used for orders and OTP. A corporate
 * contact is as likely to give a landline or a UAN, and this number is only ever read by
 * a human deciding who to call back — nothing keys off it, unlike a customer's phone,
 * which has to match a verified OTP session exactly.
 */
const phone = z
  .string()
  .trim()
  .min(7, 'Please give a phone number we can reach you on')
  .max(32)
  .refine((value) => /^[+\d][\d\s()-]{5,}$/.test(value), {
    message: 'Must be a phone number',
  })

export const createEnquirySchema = z.object({
  name: z.string().trim().min(1, 'Please tell us your name').max(120),
  phone,
  email: z.string().trim().toLowerCase().email('Must be a valid email address'),
  company: z.string().trim().max(160).optional().default(''),
  subject: z.string().trim().max(200).optional().default(''),
  message: z.string().trim().max(2000).optional().default(''),
})
