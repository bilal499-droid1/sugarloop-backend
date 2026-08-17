import { z } from 'zod'
import { OTP } from '../config/constants.js'

/**
 * The same Pakistani-mobile rule the order validator uses, normalised to the same E.164
 * form. It has to be identical: the OTP session is keyed by phone and an order is checked
 * against it, so `03001234567` and `+923001234567` differing by a character would mean a
 * customer verifying one number and being refused for ordering with "another".
 */
const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => /^(\+92|92|0)3\d{9}$/.test(value), {
    message: 'Must be a Pakistani mobile number, e.g. 03001234567',
  })
  .transform((value) => `+92${value.replace(/^\+?92|^0/, '')}`)

export const requestOtpSchema = z.object({ phone })

export const verifyOtpSchema = z.object({
  phone,
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
      message: `Must be the ${OTP.LENGTH}-digit code we sent you`,
    }),
})
