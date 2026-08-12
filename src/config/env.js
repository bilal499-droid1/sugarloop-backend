// Environment is parsed and validated ONCE, at boot, before anything else runs.
//
// The point is to fail loudly at startup rather than at 2am when the first order
// hits a code path that reads an undefined secret. A container that won't start is
// a page you can act on; a container that starts and silently signs tokens with
// `undefined` is a security incident.
import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Empty string is allowed and means "no browser origins" — correct for a
  // worker process, wrong for the API, which is why staging/production are
  // checked separately below.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_CUSTOMER_SECRET: z.string().min(16, 'JWT_CUSTOMER_SECRET must be at least 16 chars'),
  JWT_STAFF_SECRET: z.string().min(16, 'JWT_STAFF_SECRET must be at least 16 chars'),
  JWT_CUSTOMER_EXPIRES_IN: z.string().default('4d'),
  JWT_STAFF_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_STAFF_REFRESH_EXPIRES_IN: z.string().default('7d'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  // Deliberately console.error and not the logger: the logger depends on this file.
  console.error(`\nInvalid environment configuration:\n${details}\n`)
  process.exit(1)
}

const raw = parsed.data

const corsOrigins = raw.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export const env = {
  ...raw,
  corsOrigins,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
}

// The placeholder secrets shipped in .env.example must never reach a deployed
// environment. Catching it here costs nothing; catching it after launch does not.
if (!env.isDevelopment) {
  const placeholders = ['replace-me-customer', 'replace-me-staff']
  if (placeholders.includes(env.JWT_CUSTOMER_SECRET) || placeholders.includes(env.JWT_STAFF_SECRET)) {
    console.error('\nRefusing to start: JWT secrets are still the .env.example placeholders.\n')
    process.exit(1)
  }
  if (env.JWT_CUSTOMER_SECRET === env.JWT_STAFF_SECRET) {
    console.error('\nRefusing to start: customer and staff JWT secrets must differ.\n')
    process.exit(1)
  }
  if (corsOrigins.length === 0) {
    console.error('\nRefusing to start: CORS_ORIGINS is empty outside development.\n')
    process.exit(1)
  }
}
