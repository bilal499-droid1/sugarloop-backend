import { z } from 'zod'
import { passwordSchema } from './password.js'

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Must be a valid email address'),
  // Only a presence check. Enforcing the password policy here would tell an attacker
  // which guesses are even worth submitting; the policy belongs on account creation.
  password: z.string().min(1, 'Password is required'),
})

/**
 * The refresh token normally arrives in an httpOnly cookie, which JavaScript on the
 * page cannot read and therefore cannot leak through XSS. The body field is the
 * fallback for non-browser callers — curl, the mobile app, integration tests.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
})

export const logoutSchema = refreshSchema

/**
 * Changing your own password.
 *
 * The current password is required even though the caller already holds a valid access
 * token. A 15-minute token found on an unlocked phone would otherwise be enough to seize
 * the account permanently — set a new password, and the owner is locked out of their own
 * order board. Knowing the old one is what proves this is the owner and not the finder.
 *
 * Only a presence check on the current one, as at login: the policy applies to what is
 * being set, and validating what is being verified would reject the very passwords
 * predating a policy change that people most need to replace.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Your current password is required'),
    newPassword: passwordSchema,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    message: 'The new password must be different from your current one',
    path: ['newPassword'],
  })
