/**
 * The one place that talks to the WhatsApp Cloud API.
 *
 * Both message paths come through here — `otpDelivery.service.js` for verification codes
 * and `notification.service.js` for order updates. They differ only in the template they
 * name and the category Meta approved it under; the HTTP call is identical, and having
 * one copy of it means a change to the API version or the error handling is one edit.
 *
 * Every message is a *template* message. Meta only permits free-form text inside a
 * 24-hour window opened by the customer writing to us first, which never happens here:
 * an OTP is the first thing a new customer ever receives. So there is no non-template
 * send in this file, and there is no point adding one.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

/**
 * Long enough for Meta on a bad day, short enough that it cannot hold an order write
 * open. The callers differ on what they do when it expires — the OTP path surfaces the
 * failure so the customer can retry, `notify()` swallows it — but neither should wait.
 */
const TIMEOUT_MS = 10000

/**
 * Meta wants a bare international number: digits only, no `+`, no spaces, no leading
 * zero.
 *
 * Customer numbers arrive already normalised to `+923001234567` by the validators, so
 * for the OTP path this only strips the `+`. Branch numbers are the reason for the rest:
 * those are typed into the admin console by hand and reach the notification path in
 * whatever shape somebody entered them.
 */
export function toWhatsAppNumber(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')

  if (digits.startsWith('92')) return digits
  // A local mobile: 03001234567 -> 923001234567.
  if (digits.startsWith('0')) return `92${digits.slice(1)}`
  return digits
}

/**
 * Sends one approved template and returns Meta's message id.
 *
 * `params` is the ordinary case: positional body parameters, in the order the template's
 * `{{1}} {{2}}` placeholders expect. `components` is the escape hatch for templates whose
 * shape is not just a body — an Authentication template with a copy-code button has to
 * repeat the code in a button component, and Meta rejects the send if the template
 * declares one and the payload omits it.
 *
 * Throws on any non-2xx. The callers decide what that means: a customer who never gets a
 * code needs to know, an order that was placed but not announced must not be lost.
 */
export async function sendTemplate({ to, template, params = [], components }) {
  const url =
    `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}` +
    `/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`

  const body = {
    messaging_product: 'whatsapp',
    to: toWhatsAppNumber(to),
    type: 'template',
    template: {
      name: template,
      // Must match the locale the template was approved under, exactly. A template
      // approved as `en_US` and called as `en` is "not found" as far as Meta is
      // concerned — hence WHATSAPP_TEMPLATE_LANG rather than a hardcoded string.
      language: { code: env.WHATSAPP_TEMPLATE_LANG },
      components: components ?? [
        {
          type: 'body',
          parameters: params.map((text) => ({ type: 'text', text: String(text) })),
        },
      ],
    },
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response
  let payload

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    payload = await response.json().catch(() => ({}))
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    // Meta's own message is the only thing that distinguishes the failures that look
    // alike from here: a template still awaiting review, a typo in its name, and a
    // locale mismatch all arrive as the same HTTP status. Logging the code as well
    // makes them greppable — 132001 is the template one, 190 an expired token.
    const detail = payload?.error?.message ?? `HTTP ${response.status}`
    logger.error(
      { template, code: payload?.error?.code, detail },
      'WhatsApp send rejected by Meta'
    )
    throw new Error(`WhatsApp send failed: ${detail}`)
  }

  return { messageId: payload?.messages?.[0]?.id ?? null }
}
