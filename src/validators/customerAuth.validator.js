import { z } from 'zod'
import { OTP } from '../config/constants.js'

/**
 * The same normalisation the order validator applies to `contact.email`. It has to be
 * identical: the OTP session is keyed by address and an order is checked against it, so
 * `Ali@Example.com` and `ali@example.com` differing by case would mean a customer
 * verifying one address and being refused for ordering with "another".
 *
 * Lowercased rather than left as typed for the same reason, and because it also stops
 * one person holding three separate rate-limit budgets by varying the capitals.
 */
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254)

/*
 * The Pakistani-mobile rule that used to live here went with phone verification — see
 * services/otpDelivery.service.js. It is not gone from the codebase: `contact.phone` in
 * validators/order.validator.js still applies exactly the same rule and the same E.164
 * normalisation, because the order still carries a number for the rider to call. What
 * changed is only which of the two a code is sent to.
 */

export const requestOtpSchema = z.object({ email })

export const verifyOtpSchema = z.object({
  email,
  /**
   * Digits only, exactly the expected length. Trimmed and stripped of spaces first
   * because pasting from a notification often brings whitespace with it, and refusing
   * a correct code over a stray space would be a self-inflicted support ticket.
   */
  code: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s/g, ''))
    .refine((value) => new RegExp(`^\\d{${OTP.LENGTH}}$`).test(value), {
      message: `Must be the ${OTP.LENGTH}-digit code we just sent you`,
    }),
})
