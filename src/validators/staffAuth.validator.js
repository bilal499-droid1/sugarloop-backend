import { z } from 'zod'

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
