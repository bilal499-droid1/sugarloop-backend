/**
 * Getting the code to the customer's phone.
 *
 * Delivery is a swappable transport. Two of the three work: `log`, which writes the code
 * to the server console and is the development default, and `whatsapp`, which sends the
 * Authentication-category `sugarloop_otp` template through the Cloud API. `sms` is still
 * a stub — it is the fallback for a customer without WhatsApp, and needs a Twilio account
 * that does not exist.
 *
 * The OTP *rules* — expiry, attempt limits, rate limits, hashing — live in
 * `customerAuth.service.js` and are independent of all three. That separation is why
 * switching WhatsApp on was filling in one function rather than reworking the flow.
 *
 * Chosen by `OTP_TRANSPORT`. Defaults to `log`, and `assertTransportIsProductionSafe()`
 * refuses to let that default reach production, where it would mean every customer's code
 * sitting in the log stream and nobody receiving anything.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { ApiError } from '../utils/ApiError.js'
import { sendTemplate } from './whatsapp.client.js'

/**
 * The literal template name registered with Meta. Not in notification.service.js's
 * `TEMPLATES` map on purpose: everything there is Utility category and interchangeable
 * through `notify()`, while this one is Authentication, has a different payload shape,
 * and is reached by a different path. Listing it beside them would invite somebody to
 * send an order update through it, which Meta rejects.
 */
const OTP_TEMPLATE = 'sugarloop_otp'

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
 * WhatsApp Cloud API, sending the Authentication-category `sugarloop_otp` template.
 *
 * Authentication is the only category Meta permits to carry a one-time passcode, and it
 * comes with a fixed message shape rather than free copy: the code goes in the body, and
 * again in a button component when the template was built with the copy-code button
 * (which is Meta's default, and what the customer taps to fill the field). A template
 * that declares that button and a payload that omits it is rejected, so the two are
 * configured together — see WHATSAPP_OTP_HAS_COPY_BUTTON.
 *
 * Failures are raised, not swallowed. Unlike an order notification, a code that never
 * arrives is not a degraded experience: it is a customer who cannot get in, and they need
 * to be told to try again rather than left watching a screen.
 */
async function sendViaWhatsApp({ phone, code }) {
  const components = [{ type: 'body', parameters: [{ type: 'text', text: code }] }]

  if (env.WHATSAPP_OTP_HAS_COPY_BUTTON) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: code }],
    })
  }

  try {
    const { messageId } = await sendTemplate({
      to: phone,
      template: OTP_TEMPLATE,
      components,
    })
    return { channel: 'whatsapp', messageId }
  } catch (err) {
    // The underlying error carries Meta's own text and is already logged by the client.
    // What the customer gets back is deliberately vaguer: "which template is unapproved"
    // is operator information, and an error body is not where it belongs.
    logger.error({ err, template: OTP_TEMPLATE }, 'OTP delivery failed')
    throw ApiError.internal('Could not send your verification code — please try again')
  }
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
