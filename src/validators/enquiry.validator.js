import { z } from 'zod'
import { ENQUIRY_KIND } from '../config/constants.js'

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

export const createEnquirySchema = z
  .object({
    /**
     * Which form this came from. Defaulted rather than required so the corporate form —
     * which predates the FAQ one and does not send it — keeps working unchanged.
     */
    kind: z.enum(Object.values(ENQUIRY_KIND)).default(ENQUIRY_KIND.CORPORATE),

    name: z.string().trim().min(1, 'Please tell us your name').max(120),

    /**
     * Optional here and enforced below, per kind. Zod cannot express "required unless
     * kind is question" inside the field itself, and the alternative — two exported
     * schemas and a branch in the controller — puts the rule somewhere a reader of this
     * file would not find it.
     */
    phone: phone.optional(),

    email: z.string().trim().toLowerCase().email('Must be a valid email address'),
    company: z.string().trim().max(160).optional().default(''),
    subject: z.string().trim().max(200).optional().default(''),
    message: z.string().trim().max(2000).optional().default(''),
  })
  /**
   * A corporate lead gets rung up, so a number is the point of taking it. A question is
   * answered by email, and demanding a phone number before someone may ask whether the
   * donuts contain nuts loses more questions than the number would ever help answer.
   */
  .refine((body) => body.kind !== ENQUIRY_KIND.CORPORATE || Boolean(body.phone), {
    message: 'Please give a phone number we can reach you on',
    path: ['phone'],
  })
  /**
   * A question with no question in it is a blank form submitted by accident. The
   * corporate form is deliberately looser — a company that types only a name and a
   * number is still a lead worth chasing — but there is nothing to answer here.
   */
  .refine((body) => body.kind !== ENQUIRY_KIND.QUESTION || Boolean(body.message), {
    message: 'Please write your question',
    path: ['message'],
  })
