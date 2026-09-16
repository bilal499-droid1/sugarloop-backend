/**
 * The timer behind `services/orderExpiry.service.js`.
 *
 * It lives in `queues/` with the escalation ladder because that is where this codebase
 * keeps background work, but it is deliberately NOT a queue. BullMQ needs Redis, and
 * `REDIS_URL` is optional — so a queued version of this rule would silently not exist on
 * a box without Redis, which is precisely the class of failure it was written to close.
 * An interval and one indexed query owe nothing to any infrastructure, survive a
 * restart, and pick up orders that were placed before this shipped.
 *
 * Every pass re-reads the orders and the clock. Nothing is remembered between ticks, so
 * a missed tick costs a minute of lateness rather than an order that never expires.
 */
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { expireStaleOrders } from '../services/orderExpiry.service.js'

let timer = null
let running = false

/**
 * One pass, guarded against overlap.
 *
 * A pass that outruns the interval — a slow mail server, a long list — must not have a
 * second one start behind it: both would read the same `placed` rows, and while the
 * conditional update means only one can win, the loser still spends a round trip per
 * order discovering that.
 */
async function tick() {
  if (running) return
  running = true

  try {
    const { expired } = await expireStaleOrders()
    if (expired > 0) {
      logger.warn({ expired }, 'Expired unacknowledged orders')
    }
  } catch (err) {
    // Swallowed on purpose: an unhandled rejection in a timer takes the process down,
    // and a database blip must not restart the API mid-service.
    logger.error({ err }, 'Order expiry sweep failed')
  } finally {
    running = false
  }
}

/**
 * Starts the sweep. Returns null when auto-cancel is switched off.
 *
 * `unref()` so the timer never holds the process open: a shutdown that has closed the
 * database should not wait up to a minute for a sweep it no longer wants.
 */
export function startOrderExpiry() {
  if (env.ORDER_AUTO_CANCEL_MINUTES === 0) {
    logger.warn(
      'ORDER EXPIRY: ORDER_AUTO_CANCEL_MINUTES is 0, so an order nobody confirms will ' +
        'sit in `placed` indefinitely and the customer will never hear anything.'
    )
    return null
  }

  timer = setInterval(tick, env.ORDER_EXPIRY_SWEEP_SECONDS * 1000)
  timer.unref?.()

  logger.info(
    {
      afterMinutes: env.ORDER_AUTO_CANCEL_MINUTES,
      everySeconds: env.ORDER_EXPIRY_SWEEP_SECONDS,
    },
    'Order expiry sweep started'
  )

  return timer
}

/** Stops the sweep on shutdown. Safe when it never started. */
export function stopOrderExpiry() {
  if (!timer) return

  clearInterval(timer)
  timer = null
}
