import { z } from 'zod'

/**
 * The password policy, in one place.
 *
 * Two endpoints set a password and they must not drift apart: an admin creating or
 * resetting an account (`staffUser.validator.js`) and a staff member changing their own
 * (`staffAuth.validator.js`). A policy defined twice is a policy that is eventually
 * enforced once.
 *
 * bcrypt hashes only the first 72 BYTES of input and silently ignores the rest, so a
 * longer password is not the stronger password the user believes they chose. Rejecting
 * it is honest; truncating it quietly is not.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
    message: 'Password must be at most 72 bytes',
  })
