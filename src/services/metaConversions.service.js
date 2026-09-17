/**
 * Meta Conversions API: telling Facebook, server to server, that an order was placed.
 *
 * The storefront fires the same `Purchase` through the Meta Pixel in the browser. This copy
 * exists because that one is unreliable by design — ad blockers, Safari's tracking
 * protection and iOS privacy settings all drop Pixel requests, and every dropped purchase
 * is an ad Meta thinks did not work. A request from this server cannot be blocked.
 *
 * Both copies carry the same `event_id` (`metaEventId` below), which is how Meta knows they
 * are one purchase and counts it once. The storefront gets the id from the order response,
 * so the two can never disagree.
 *
 * Fired at PLACEMENT, not at confirmation. An order the branch later fails still counts as
 * a purchase to Meta. The trade is deliberate: an event sent at placement has a browser twin
 * to deduplicate against and reaches Meta while the ad click is fresh, whereas one sent when
 * staff confirm it minutes later has neither.
 *
 * Told, never asked. Nothing here can fail an order: errors and timeouts are logged and
 * swallowed, and the caller does not wait for the request.
 */
import crypto from 'node:crypto'

import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { toRupees } from '../utils/money.js'

/** Short: a checkout does not wait on this, but a hung socket should not linger either. */
const TIMEOUT_MS = 5000

/** Deterministic, so the thank-you page and a reloaded order lookup produce the same id. */
export function metaEventId(order) {
  return `purchase_${order.orderNumber}`
}

export const isMetaConversionsEnabled = () => Boolean(env.META_PIXEL_ID && env.META_CAPI_TOKEN)

/**
 * Meta matches customers on SHA-256 of normalised values, so this is the only form any
 * personal detail leaves in. Empty input yields undefined, which JSON drops — Meta rejects
 * a hash of an empty string as a malformed parameter.
 */
const sha256 = (value) =>
  value ? crypto.createHash('sha256').update(value).digest('hex') : undefined

/** Meta's normalisation rules: lowercase, and for names and cities no spaces or punctuation. */
const squash = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** Contact phones are stored as `+923001234567`; Meta wants the digits with country code. */
const phoneDigits = (phone) => String(phone ?? '').replace(/\D/g, '')

function userData(order, context) {
  const [firstName, ...rest] = String(order.contact.name ?? '').trim().split(/\s+/)

  const hashed = {
    em: sha256(order.contact.email?.trim().toLowerCase()),
    ph: sha256(phoneDigits(order.contact.phone)),
    fn: sha256(squash(firstName)),
    ln: sha256(squash(rest.join(''))),
    ct: sha256(squash(order.address?.city)),
    country: sha256('pk'),
    // The verified email is the most stable handle this shop has on a person.
    external_id: sha256(order.contact.email?.trim().toLowerCase()),
  }

  return {
    // Meta takes the hashed fields as arrays. Drop the empty ones rather than send [null].
    ...Object.fromEntries(
      Object.entries(hashed)
        .filter(([, value]) => value)
        .map(([key, value]) => [key, [value]])
    ),
    client_ip_address: context.ip || undefined,
    client_user_agent: context.userAgent || undefined,
    // Set by the Pixel in the customer's browser. `_fbc` ties this purchase to the ad
    // click itself, and is the single biggest lift to match quality after the phone.
    fbp: context.fbp || undefined,
    fbc: context.fbc || undefined,
  }
}

/** A Build Your Box line has no sku of its own; its product id still identifies it. */
const contentId = (item) => item.sku ?? (item.productId ? String(item.productId) : item.name)

/**
 * The event body, separate from the send so it can be checked without a network.
 * Amounts leave in rupees: stored money is hundredths (see utils/money.js), and sending
 * that raw would report every order to Meta at a hundred times its value.
 */
export function buildPurchaseEvent(order, context = {}, { now = new Date() } = {}) {
  return {
    event_name: 'Purchase',
    event_time: Math.floor(now.getTime() / 1000),
    event_id: metaEventId(order),
    action_source: 'website',
    event_source_url: context.sourceUrl || undefined,
    user_data: userData(order, context),
    custom_data: {
      currency: 'PKR',
      value: toRupees(order.totals.grandTotal),
      order_id: order.orderNumber,
      content_type: 'product',
      content_ids: order.items.map(contentId),
      contents: order.items.map((item) => ({
        id: contentId(item),
        quantity: item.qty,
        item_price: toRupees(item.unitPrice),
      })),
      num_items: order.items.reduce((sum, item) => sum + item.qty, 0),
    },
  }
}

/**
 * Sends the Purchase event. Resolves either way and never throws; does nothing at all
 * until META_PIXEL_ID and META_CAPI_TOKEN are set.
 *
 * @param context  { ip, userAgent, fbp, fbc, sourceUrl } from the request that placed it
 */
export async function sendPurchase(order, context = {}, { now = new Date() } = {}) {
  if (!isMetaConversionsEnabled()) return

  const url = `https://graph.facebook.com/${env.META_API_VERSION}/${env.META_PIXEL_ID}/events`

  const body = {
    data: [buildPurchaseEvent(order, context, { now })],
    // While set, events land in Events Manager > Test events and are NOT used for ads.
    // Remove it once the test order shows up there as deduplicated.
    test_event_code: env.META_TEST_EVENT_CODE || undefined,
    // In the body rather than the query string, so it never appears in a proxy log.
    access_token: env.META_CAPI_TOKEN,
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      // 190 is an expired or revoked token; 100 usually a wrong pixel id.
      logger.error(
        {
          orderNumber: order.orderNumber,
          code: payload?.error?.code,
          detail: payload?.error?.message ?? `HTTP ${response.status}`,
        },
        'Meta Conversions API rejected the Purchase event'
      )
      return
    }

    logger.info(
      { orderNumber: order.orderNumber, eventsReceived: payload?.events_received },
      'Meta Purchase event sent'
    )
  } catch (error) {
    logger.error(
      { orderNumber: order.orderNumber, err: error.message },
      'Meta Conversions API request failed'
    )
  }
}
