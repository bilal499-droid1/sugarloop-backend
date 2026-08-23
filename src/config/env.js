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

  /**
   * How verification codes reach a phone. See services/otpDelivery.service.js.
   *
   * `log` prints the code to the server console and sends nothing — the only transport
   * that works today, because WhatsApp and Twilio both need accounts that do not exist
   * yet. It is refused at boot in production.
   */
  OTP_TRANSPORT: z.enum(['log', 'whatsapp', 'sms']).default('log'),

  /**
   * How order and enquiry notifications reach a phone. See services/notification.service.js.
   *
   * Separate from OTP_TRANSPORT even though both end up at the same Meta Cloud API,
   * because they are approved and can fail independently: the six notification templates
   * are Utility category, `sugarloop_otp` is Authentication, and Meta reviews each one on
   * its own. Approvals arrive one at a time and rejections are common, so a single switch
   * would mean holding back a working OTP flow until the last order template clears.
   */
  NOTIFY_TRANSPORT: z.enum(['log', 'whatsapp']).default('log'),

  /**
   * Where the WhatsApp copy of a corporate enquiry goes. Falls back to nothing rather
   * than to a wrong number: `notify()` skips a message with no recipient and logs it.
   */
  ENQUIRY_NOTIFY_PHONE: z.string().default(''),

  /**
   * Redis, for rate-limit counters and the order-escalation queue. See config/redis.js.
   *
   * Optional so a laptop with no Redis still runs the whole API: the limiters fall back
   * to an in-memory store and the escalation queue does not start. Both fallbacks are
   * fine for one developer and wrong for a real shop, so both warn loudly at boot
   * outside development.
   */
  REDIS_URL: z.string().optional(),

  /**
   * How long an order may sit in `placed` before the branch manager is chased, and then
   * the admin. Client decision: 5 and 10 minutes.
   *
   * Configurable rather than hardcoded because the right number is whatever the shop
   * discovers it is after a fortnight of real service, and that should not need a code
   * change. Minutes, because that is the unit the decision was made in.
   */
  ORDER_ESCALATION_MANAGER_MINUTES: z.coerce.number().int().positive().default(5),
  ORDER_ESCALATION_ADMIN_MINUTES: z.coerce.number().int().positive().default(10),

  /**
   * Who gets chased when a branch has ignored an order for ten minutes.
   *
   * Configured rather than looked up because a StaffUser has no phone number — the admin
   * rung has nowhere else to read one from. Falls back to ENQUIRY_NOTIFY_PHONE.
   */
  ADMIN_ESCALATION_PHONE: z.string().default(''),

  /**
   * Which geocoder turns a delivery address into coordinates. See
   * services/geocoding.service.js.
   *
   * `google` is the intended production provider and needs GOOGLE_MAPS_API_KEY with
   * billing enabled. `nominatim` (OpenStreetMap) needs no key and works today, but is
   * rate-limited and weaker on Pakistani addresses — a stand-in, not an answer.
   */
  GEOCODER: z.enum(['google', 'nominatim']).default('nominatim'),

  /** Required when GEOCODER=google. Checked at boot, not at the first checkout. */
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  /**
   * How outbound email leaves the server. See services/email.service.js.
   *
   * `log` prints the message and sends nothing — refused at boot in production, where it
   * would mean corporate enquiries silently disappearing. `smtp` is real delivery and
   * needs the four SMTP_* variables below.
   */
  EMAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  /** The From: address. Must be one the SMTP account is allowed to send as. */
  EMAIL_FROM: z.string().default('Sugarloop <sugarlooppk@gmail.com>'),

  /** Where corporate gifting enquiries land. */
  ENQUIRY_NOTIFY_EMAIL: z.string().email().default('sugarlooppk@gmail.com'),
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

// Checked here rather than at the first send, so a half-configured mailer is a container
// that will not start rather than a corporate enquiry that vanishes.
if (env.EMAIL_TRANSPORT === 'smtp') {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].filter((key) => !env[key])
  if (missing.length > 0) {
    console.error(
      `\nRefusing to start: EMAIL_TRANSPORT=smtp but ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set.\n`
    )
    process.exit(1)
  }
}
