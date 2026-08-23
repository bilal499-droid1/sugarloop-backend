/**
 * The Redis connection, shared by everything that needs one.
 *
 * Two consumers today: the rate limiters, and the BullMQ queue that runs the
 * unacknowledged-order escalation. One client rather than one each — a second connection
 * buys nothing and doubles what has to be closed on shutdown.
 *
 * **Optional by design.** With `REDIS_URL` unset this module hands back null and the
 * callers fall back: the limiters use their in-memory store, and the escalation queue
 * does not start. That keeps `npm run dev` and the test suite working on a laptop with
 * no Redis installed, which is the difference between a prerequisite people install and
 * one they work around.
 *
 * The trade is stated where it matters — see `middleware/rateLimit.js` for what an
 * in-memory limiter actually costs.
 */
import Redis from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

let client = null

/**
 * The shared client, or null when Redis is not configured.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ: its blocking commands sit open for
 * far longer than ioredis's default retry budget allows, and with a limit set they are
 * killed mid-wait and the worker stalls.
 *
 * `lazyConnect` is deliberately NOT set. A connection that only opens on first use would
 * make a misconfigured REDIS_URL surface as a failed OTP at checkout rather than as a
 * loud error at boot.
 */
export function getRedis() {
  if (!env.REDIS_URL) return null
  if (client) return client

  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  })

  /**
   * Logged, not thrown. ioredis reconnects on its own, and an unhandled 'error' event on
   * an EventEmitter takes the process down — so a thirty-second Redis blip would kill an
   * API that is perfectly capable of serving the menu without it.
   */
  client.on('error', (err) => {
    logger.error({ err }, 'Redis connection error')
  })

  client.on('ready', () => {
    logger.info('Redis connected')
  })

  return client
}

/** Closes the connection on shutdown. Safe to call when Redis was never configured. */
export async function disconnectRedis() {
  if (!client) return

  try {
    await client.quit()
  } catch {
    // Already gone, or never established. Nothing to do on the way out.
  } finally {
    client = null
  }
}
