/**
 * Getting the code to the customer.
 *
 * Delivery is a swappable transport, chosen by `OTP_TRANSPORT`. Which one you pick also
 * decides what is being verified, because a code can only go where there is an address
 * to send it:
 *
 *   log       writes the code to the server console and sends nothing. The development
 *             default, refused in production by `assertTransportIsProductionSafe()`.
 *   email     mails it, through the same SMTP transport the corporate enquiries use.
 *             This is what checkout runs on now.
 *   whatsapp  sends the Authentication-category `sugarloop_otp` template through the
 *             Cloud API, to a phone.
 *   sms       a Twilio stub, to a phone. Never implemented.
 *
 * **Why email.** Verification used to prove the customer held the phone number the order
 * would be called back on, which is the right thing to prove for Cash on Delivery: a
 * prank order then costs the prankster a real, reachable SIM. Email does not buy that —
 * a throwaway inbox is free — so this is a deliberate trade, made because the WhatsApp
 * sender is still waiting on Meta (number ID, token, and the `sugarloop_otp` template
 * review) while SMTP needed nothing but a Gmail app password. The phone is still
 * collected on every order and is still what the branch calls; it is simply no longer
 * proven. `whatsapp` and `sms` are kept intact below for the day that changes — nothing
 * about them was deleted, they are just not reachable from a checkout that now sends an
 * address rather than a number.
 *
 * The OTP *rules* — expiry, attempt limits, rate limits, hashing — live in
 * `customerAuth.service.js` and are independent of all four. That separation is why
 * changing what gets verified was changing the key, not reworking the flow.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { OTP } from '../config/constants.js'
import { ApiError } from '../utils/ApiError.js'
import { sendTemplate } from './whatsapp.client.js'
import { sendEmail } from './email.service.js'

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
async function sendViaLog({ recipient, code }) {
  logger.info(
    `\n  ┌───────────────────────────────────────────┐\n` +
      `  │  OTP for ${recipient.padEnd(16)}             │\n` +
      `  │  CODE: ${code}                            │\n` +
      `  └───────────────────────────────────────────┘\n` +
      `  (OTP_TRANSPORT=log — no message was actually sent)`
  )
  return { channel: 'log', messageId: null }
}

/**
 * Email, through the shop's own mailbox.
 *
 * Plain text, not HTML, and the code is on its own line: a six-digit number is the whole
 * payload, and every mail client on earth renders a short plaintext body correctly while
 * a proportion of them mangle or strip HTML. It also keeps the message from tripping the
 * heuristics that put a first-time HTML mail from a Gmail sender into spam.
 *
 * The subject leads with the code. Most people read this off a lock-screen notification
 * and never open the mail at all, and the subject is the part that shows there.
 *
 * Failures are raised, not swallowed. Unlike an order notification, a code that never
 * arrives is not a degraded experience: it is a customer who cannot order, and they need
 * to be told to try again rather than left watching a screen.
 */
async function sendViaEmail({ recipient, code }) {
  try {
    const { messageId } = await sendEmail({
      to: recipient,
      subject: `${code} is your Sugarloop verification code`,
      text:
        `Your Sugarloop verification code is:\n\n` +
        `    ${code}\n\n` +
        `It expires in ${OTP.TTL_MINUTES} minutes and can only be used once.\n\n` +
        `If you did not try to place an order with us, you can ignore this email — ` +
        `nobody can do anything with the code but you.\n`,
    })

    return { channel: 'email', messageId }
  } catch (err) {
    // The underlying error carries the SMTP server's own text and is already logged by
    // the mailer. What the customer gets back is deliberately vaguer: "relay access
    // denied for this mailbox" is operator information, and an error body is not where
    // it belongs.
    logger.error({ err }, 'OTP email delivery failed')
    throw ApiError.internal('Could not send your verification code — please try again')
  }
}

/**
 * WhatsApp Cloud API, sending the Authentication-category `sugarloop_otp` template.
 *
 * Not reachable from the current checkout, which verifies an email address — kept for
 * when the Meta approvals land and phone verification comes back. `recipient` is a phone
 * number in E.164 here, which is what makes this transport and `email` mutually
 * exclusive rather than interchangeable.
 *
 * Authentication is the only category Meta permits to carry a one-time passcode, and it
 * comes with a fixed message shape rather than free copy: the code goes in the body, and
 * again in a button component when the template was built with the copy-code button
 * (which is Meta's default, and what the customer taps to fill the field). A template
 * that declares that button and a payload that omits it is rejected, so the two are
 * configured together — see WHATSAPP_OTP_HAS_COPY_BUTTON.
 */
async function sendViaWhatsApp({ recipient, code }) {
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
      to: recipient,
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
    'SMS OTP delivery is not implemented yet — set OTP_TRANSPORT=email for development'
  )
}

const TRANSPORTS = {
  log: sendViaLog,
  email: sendViaEmail,
  whatsapp: sendViaWhatsApp,
  sms: sendViaSms,
}

export const AVAILABLE_TRANSPORTS = Object.keys(TRANSPORTS)

/**
 * Which transports deliver to an email address rather than a phone number.
 *
 * `customerAuth.service.js` verifies an email, so a transport that can only reach a
 * handset would accept the address and then send the code somewhere else entirely — or,
 * for `whatsapp`, hand Meta an "@" as a phone number and fail with something unreadable.
 * Checked at boot rather than at the first checkout.
 */
const EMAIL_ADDRESSED = new Set(['log', 'email'])

/**
 * The `log` transport delivers nothing and prints a live credential. In production that
 * is both a broken checkout and a logged secret, so it is refused at boot rather than
 * discovered by a customer who never received a code.
 *
 * The second check is the changeover's own footgun: `OTP_TRANSPORT` still accepts the
 * two phone transports, and leaving one set now means every verification attempt fails
 * at the send. Better a container that will not start than a checkout nobody can finish.
 */
export function assertTransportIsProductionSafe() {
  if (env.isProduction && env.OTP_TRANSPORT === 'log') {
    console.error(
      '\nRefusing to start: OTP_TRANSPORT=log in production would print every ' +
        'verification code to the logs and send nothing to the customer.\n'
    )
    process.exit(1)
  }

  if (!EMAIL_ADDRESSED.has(env.OTP_TRANSPORT)) {
    console.error(
      `\nRefusing to start: OTP_TRANSPORT=${env.OTP_TRANSPORT} delivers to a phone ` +
        'number, but checkout verifies an email address. Use OTP_TRANSPORT=email.\n'
    )
    process.exit(1)
  }
}

export async function deliverOtp({ recipient, code }) {
  const send = TRANSPORTS[env.OTP_TRANSPORT]
  if (!send) throw ApiError.internal(`Unknown OTP_TRANSPORT: ${env.OTP_TRANSPORT}`)

  return send({ recipient, code })
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
