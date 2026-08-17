/**
 * Getting the code to the customer's phone.
 *
 * ⚠️ **No delivery provider is configured yet.** WhatsApp Cloud API needs a Meta Business
 * account, a verified number and per-template approval (1–3 days each, ×7 templates);
 * Twilio needs an account. Neither exists, and neither is something this repo can create.
 *
 * So delivery is a swappable transport with one working implementation — `log`, which
 * writes the code to the server console — and named stubs for the two real providers.
 * The point is that the OTP *rules* (expiry, attempts, rate limits, hashing) are real and
 * finished now, and switching on WhatsApp later is filling in one function rather than
 * rewriting the flow.
 *
 * Chosen by `OTP_TRANSPORT`. Defaults to `log`, and `assertTransportIsProductionSafe()`
 * refuses to let that default reach production, where it would mean every customer's code
 * sitting in the log stream and nobody receiving anything.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { ApiError } from '../utils/ApiError.js'

/**
 * Development transport: print it and move on.
 *
 * Deliberately loud and deliberately not `logger.debug` — someone testing checkout needs
 * to find this line without changing the log level.
 */
async function sendViaLog({ phone, code }) {
  logger.info(
    `\n  ┌───────────────────────────────────────────┐\n` +
      `  │  OTP for ${phone.padEnd(16)}             │\n` +
      `  │  CODE: ${code}                            │\n` +
      `  └───────────────────────────────────────────┘\n` +
      `  (OTP_TRANSPORT=log — no message was actually sent)`
  )
  return { channel: 'log', messageId: null }
}

/**
 * WhatsApp Cloud API. Not implemented — blocked on the client's Meta Business account.
 *
 * When it lands: POST to
 * `https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_NUMBER_ID}/messages` with an
 * `authentication`-category template (`sugarloop_otp`), the code as the body parameter.
 * Auth templates are the only category Meta permits for one-time passcodes, and they
 * must be approved before a single message will send.
 */
async function sendViaWhatsApp() {
  throw ApiError.internal(
    'WhatsApp OTP delivery is not implemented yet — set OTP_TRANSPORT=log for development'
  )
}

/** Twilio SMS, the fallback for customers without WhatsApp. Also not implemented. */
async function sendViaSms() {
  throw ApiError.internal(
    'SMS OTP delivery is not implemented yet — set OTP_TRANSPORT=log for development'
  )
}

const TRANSPORTS = {
  log: sendViaLog,
  whatsapp: sendViaWhatsApp,
  sms: sendViaSms,
}

export const AVAILABLE_TRANSPORTS = Object.keys(TRANSPORTS)

/**
 * The `log` transport delivers nothing and prints a live credential. In production that
 * is both a broken checkout and a logged secret, so it is refused at boot rather than
 * discovered by a customer who never received a code.
 */
export function assertTransportIsProductionSafe() {
  if (env.isProduction && env.OTP_TRANSPORT === 'log') {
    console.error(
      '\nRefusing to start: OTP_TRANSPORT=log in production would print every ' +
        'verification code to the logs and send nothing to the customer.\n'
    )
    process.exit(1)
  }
}

export async function deliverOtp({ phone, code }) {
  const send = TRANSPORTS[env.OTP_TRANSPORT]
  if (!send) throw ApiError.internal(`Unknown OTP_TRANSPORT: ${env.OTP_TRANSPORT}`)

  return send({ phone, code })
}

/**
 * Whether the API may hand the code back in the response body.
 *
 * True only for the `log` transport outside production — i.e. exactly when nothing is
 * actually delivering the message and a developer or Postman run would otherwise have no
 * way to complete a checkout. Two independent conditions, because either one alone is
 * one mistake away from returning live codes to anyone who asks.
 */
export function mayEchoCode() {
  return !env.isProduction && env.OTP_TRANSPORT === 'log'
}
