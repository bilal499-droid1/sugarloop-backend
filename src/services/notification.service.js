/**
 * Order and enquiry notifications.
 *
 * A swappable transport, the same shape as `otpDelivery.service.js` and
 * `email.service.js`, and for the same reason: the events that fire these are finished
 * and working now, and the WhatsApp account that carries them is the client's to create.
 * Chosen by `NOTIFY_TRANSPORT`.
 *
 *   log        renders the whole message to the server console and sends nothing. The
 *              development default, and refused at boot in production.
 *   whatsapp   the Meta Cloud API. Not implemented — see `sendViaWhatsApp` below.
 *
 * **Nothing in this module is allowed to throw.** Every caller is a write that has
 * already succeeded: the order is placed, the status has moved, the lead is stored. A
 * notification failing must not turn any of those into a 500, because the operator would
 * then repeat an action that already happened — a second transition on an order, or a
 * customer told their order failed when a rider is on the way. `notify()` swallows and
 * logs, exactly as `audit.service.js` does and for the same reason.
 *
 * This is fire-and-forget by design. What it does NOT do is record whether the message
 * arrived: Meta reports that asynchronously on the inbound webhook, which is a separate
 * piece of work. Until that exists, the log stream is the record.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { FULFILMENT, ORDER_STATUS } from '../config/constants.js'
import { formatPKR } from '../utils/money.js'

/**
 * The templates Meta has to approve, and the parameters each one takes.
 *
 * The names are the literal template names registered with Meta — changing a string here
 * means re-submitting for approval, so they are declared once rather than typed at each
 * call site. `sugarloop_otp` is deliberately absent: it is an Authentication-category
 * template on a different delivery path, and it lives in `otpDelivery.service.js`.
 *
 * Every template ends with "Need help? Call us on <branch phone>" — a client decision,
 * and a necessary one. A customer who replies to one of these reaches the API, not a
 * person, so the message has to carry a number that a human actually answers.
 */
export const TEMPLATES = Object.freeze({
  ORDER_PLACED: 'sugarloop_order_placed',
  OUT_FOR_DELIVERY: 'sugarloop_out_for_delivery',
  READY_FOR_PICKUP: 'sugarloop_ready_for_pickup',
  ORDER_COMPLETED: 'sugarloop_order_completed',
  NEW_ORDER_STAFF: 'sugarloop_new_order_staff',
  ENQUIRY_STAFF: 'sugarloop_enquiry_staff',
})

/**
 * Which customer-facing template a status change fires, if any.
 *
 * `confirmed` and `preparing` are deliberately silent. They are kitchen bookkeeping, and
 * a shop that messages twice in five minutes to say "we have seen it" and then "we have
 * started it" trains customers to mute the number that later carries their OTP.
 *
 * `failed` is silent too: it is the one status that needs a human explaining what
 * happened and what the customer gets instead, and the fail-reason form already prompts
 * the branch to make that call.
 */
const STATUS_TEMPLATES = Object.freeze({
  [ORDER_STATUS.OUT_FOR_DELIVERY]: TEMPLATES.OUT_FOR_DELIVERY,
  [ORDER_STATUS.READY_FOR_PICKUP]: TEMPLATES.READY_FOR_PICKUP,
  [ORDER_STATUS.COMPLETED]: TEMPLATES.ORDER_COMPLETED,
})

/**
 * Development transport: render it and move on.
 *
 * `logger.info` rather than `debug` on purpose — someone working through a checkout needs
 * to see what the customer would have received without changing the log level. Same
 * reasoning as the `log` transports for OTP and email.
 */
async function sendViaLog({ to, template, params }) {
  const rendered = params.map((value, i) => `  │  {{${i + 1}}} ${value}`).join('\n')

  logger.info(
    `\n  ┌─ WHATSAPP (not sent — NOTIFY_TRANSPORT=log) ──────────\n` +
      `  │  To:       ${to}\n` +
      `  │  Template: ${template}\n` +
      `  ├───────────────────────────────────────────────────────\n` +
      `${rendered}\n` +
      `  └───────────────────────────────────────────────────────`
  )

  return { transport: 'log', messageId: null }
}

/**
 * WhatsApp Cloud API. Not implemented — blocked on the client's Meta Business account.
 *
 * When it lands it is the same call `otpDelivery.sendViaWhatsApp` makes: POST to
 * `https://graph.facebook.com/v{version}/{WHATSAPP_PHONE_NUMBER_ID}/messages` with a
 * `template` message, `params` as the body component's positional parameters, in order.
 *
 * The difference from the OTP path is the category. These six are Utility templates,
 * which Meta permits for transactional updates about something the customer has already
 * done; `sugarloop_otp` is Authentication, which is the only category allowed to carry a
 * one-time passcode. A Utility template carrying a code is rejected, and an
 * Authentication template carrying an order update is too.
 */
async function sendViaWhatsApp() {
  throw new Error(
    'WhatsApp notifications are not implemented yet — set NOTIFY_TRANSPORT=log for development'
  )
}

const TRANSPORTS = {
  log: sendViaLog,
  whatsapp: sendViaWhatsApp,
}

export const AVAILABLE_NOTIFY_TRANSPORTS = Object.keys(TRANSPORTS)

/**
 * The `log` transport delivers nothing. In production that is a shop whose customers are
 * never told their order was placed, confirmed or sent — and, worse, a branch never told
 * an order came in, which is an order nobody makes.
 *
 * Refused at boot for the same reason as the OTP and email transports: a silent
 * notification channel is discovered by a customer ringing to ask where their donuts are,
 * which is the most expensive possible way to find out.
 */
export function assertNotifyTransportIsProductionSafe() {
  if (env.isProduction && env.NOTIFY_TRANSPORT === 'log') {
    console.error(
      '\nRefusing to start: NOTIFY_TRANSPORT=log in production would send no order ' +
        'notifications at all — neither to customers nor to the branch making the order.\n'
    )
    process.exit(1)
  }
}

/**
 * Sends one templated message. Never throws.
 *
 * `send` is injectable for the tests, the same seam `enquiry.service.js` uses: ES module
 * exports are frozen bindings, so the alternative is a mocking loader hook or a suite
 * that talks to Meta. The rule most worth testing here is what happens when the send
 * fails, which needs a send that fails on demand.
 */
export async function notify({ to, template, params = [] }, { send } = {}) {
  const transport = send ?? TRANSPORTS[env.NOTIFY_TRANSPORT]

  if (!transport) {
    logger.error({ template, transport: env.NOTIFY_TRANSPORT }, 'Unknown NOTIFY_TRANSPORT')
    return { sent: false }
  }

  // A template with no recipient is not an error worth raising — a pickup order has no
  // rider to message, and a branch with no phone on file is a seeding gap, not a bug in
  // the order that triggered it. Both are worth seeing in the log, neither is worth
  // failing a write over.
  if (!to) {
    logger.warn({ template }, 'Notification skipped — no recipient number')
    return { sent: false }
  }

  try {
    const result = await transport({ to, template, params })
    return { sent: true, ...result }
  } catch (err) {
    logger.error({ err, to, template }, 'Notification failed to send')
    return { sent: false }
  }
}

/** The branch line every template signs off with, so a reply reaches a human. */
function branchPhone(branch) {
  return branch?.phone ?? ''
}

/**
 * A customer has placed an order: tell them, and tell the branch that has to make it.
 *
 * Two messages, and the staff one matters more. The customer already saw a confirmation
 * screen; the branch has no idea an order exists until something tells it, and an order
 * sitting unseen in a queue is the failure mode the whole escalation timer exists to
 * catch later.
 *
 * `branch` is passed rather than re-read: `order.service.create` already has it loaded
 * and attaches it as `$branch`, and a notification is not worth a second query.
 */
export async function notifyOrderPlaced(order, branch, options) {
  const total = formatPKR(order.totals.grandTotal)
  const isDelivery = order.fulfilment === FULFILMENT.DELIVERY

  await notify(
    {
      to: order.contact.phone,
      template: TEMPLATES.ORDER_PLACED,
      params: [
        order.contact.name,
        order.orderNumber,
        total,
        isDelivery ? 'delivered to you' : `ready for collection at ${branch?.name ?? 'the shop'}`,
        branchPhone(branch),
      ],
    },
    options
  )

  await notify(
    {
      to: branchPhone(branch),
      template: TEMPLATES.NEW_ORDER_STAFF,
      params: [
        order.orderNumber,
        branch?.name ?? '',
        total,
        isDelivery ? 'Delivery' : 'Pickup',
        String(order.items?.length ?? 0),
      ],
    },
    options
  )
}

/**
 * An order has moved. Tell the customer, if this is a move they care about.
 *
 * Returns quietly for the statuses that fire nothing — see `STATUS_TEMPLATES`. The caller
 * does not have to know which those are, so adding or removing one is a change here
 * rather than in the transition handler.
 */
export async function notifyStatusChange(order, branch, options) {
  const template = STATUS_TEMPLATES[order.status]
  if (!template) return

  await notify(
    {
      to: order.contact.phone,
      template,
      params: [order.contact.name, order.orderNumber, branchPhone(branch)],
    },
    options
  )
}

/**
 * A corporate gifting enquiry or a question from the FAQ page has arrived.
 *
 * This is the second notification on the same event — `enquiry.service` already emails
 * it — and that redundancy is deliberate rather than sloppy. The email is the one that
 * carries the whole message and can be replied to; this is the one that gets noticed
 * within the hour. A lead worth 200 boxes is worth telling someone about twice.
 */
export async function notifyEnquiryReceived(enquiry, options) {
  await notify(
    {
      to: env.ENQUIRY_NOTIFY_PHONE,
      template: TEMPLATES.ENQUIRY_STAFF,
      params: [
        enquiry.name,
        enquiry.company || enquiry.email,
        enquiry.subject || 'No subject',
        String(enquiry.id ?? enquiry._id ?? ''),
      ],
    },
    options
  )
}
