/**
 * The unacknowledged-order escalation.
 *
 * An order arrives, the branch is messaged, and then nothing in the system notices if
 * nobody acts on it. On a busy evening that is an order sitting in a queue while a
 * customer waits for donuts that were never started — the failure the whole order board
 * exists to prevent, and the one it cannot prevent on its own, because a board only
 * helps somebody who is looking at it.
 *
 * So: two delayed jobs per order. At five minutes the branch is chased, at ten the admin
 * is. Both are cancelled the moment the order leaves `placed`, because confirming it IS
 * the acknowledgement — there is no separate "seen" button to forget to press.
 *
 * **The order's own status is the authority, not the job.** Every job re-reads the order
 * before sending and does nothing if it has moved. Cancellation is an optimisation on
 * top of that check, not a substitute for it: a job can already be running when the
 * cancel lands, the API can be restarted between enqueue and fire, and a queue that
 * trusted its own bookkeeping would chase managers about orders they finished ten
 * minutes ago. That erodes trust in the alert far faster than a missed one does.
 *
 * **Optional, like Redis.** With no `REDIS_URL` the queue never starts and the API runs
 * exactly as it did before — which is right for a laptop and wrong for a shop, so it
 * warns at boot outside development.
 */
import { Queue, Worker } from 'bullmq'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { getRedis } from '../config/redis.js'
import { ORDER_STATUS } from '../config/constants.js'
import { Order } from '../models/Order.js'
import { notifyOrderUnacknowledged } from '../services/notification.service.js'

const QUEUE_NAME = 'order-escalation'

/** Who gets chased at each rung. */
export const ESCALATION_LEVELS = Object.freeze({
  MANAGER: 'manager',
  ADMIN: 'admin',
})

let queue = null
let worker = null

/**
 * One job id per order per level.
 *
 * Deterministic on purpose: it makes enqueueing idempotent — a retried order write
 * cannot produce two chases for one order — and it means cancellation needs nothing
 * stored on the order beyond its own id.
 */
function jobId(orderId, level) {
  return `escalate:${orderId}:${level}`
}

const LEVELS = [
  { level: ESCALATION_LEVELS.MANAGER, minutes: () => env.ORDER_ESCALATION_MANAGER_MINUTES },
  { level: ESCALATION_LEVELS.ADMIN, minutes: () => env.ORDER_ESCALATION_ADMIN_MINUTES },
]

/**
 * Where a chase goes.
 *
 * The manager rung uses the BRANCH's phone, not the manager's own. StaffUser carries no
 * phone number at all, and the branch line is the better target anyway: it rings where
 * the order is actually being made, and it reaches whoever is on shift rather than
 * whichever named account happens to own the branch this month.
 *
 * The admin rung is configured rather than looked up, for the same reason — there is no
 * phone on a staff account to look up. It falls back to the enquiry number, which is the
 * shop's own line and a reasonable last resort for "nobody has touched this in ten
 * minutes". An empty result is handled by the caller: it logs and sends nothing rather
 * than guessing at a number.
 */
function recipientFor(level, branch) {
  if (level === ESCALATION_LEVELS.MANAGER) return branch?.phone ?? ''

  return env.ADMIN_ESCALATION_PHONE || env.ENQUIRY_NOTIFY_PHONE || ''
}

/** The queue, or null when Redis is not configured. */
function getQueue() {
  if (queue) return queue

  const connection = getRedis()
  if (!connection) return null

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // A chase that failed is worth two more goes; beyond that the provider is down and
      // retrying forever only fills the queue.
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      // Completed jobs are noise once the order moved on. Failures are kept: an
      // escalation that never fired is exactly what somebody investigating a late order
      // needs to find.
      removeOnComplete: true,
      removeOnFail: 500,
    },
  })

  return queue
}

/**
 * Starts the chase clock for a newly placed order. Never throws.
 *
 * Called from the same place the order is created, and held to the same rule as the
 * notifications: the order exists, so a queue failure must not turn a successful
 * checkout into a 500 that invites the customer to order twice.
 */
export async function scheduleOrderEscalation(order) {
  const q = getQueue()
  if (!q) return { scheduled: false }

  try {
    await Promise.all(
      LEVELS.map(({ level, minutes }) =>
        q.add(
          level,
          { orderId: String(order._id), level, waitedMinutes: minutes() },
          { jobId: jobId(order._id, level), delay: minutes() * 60_000 }
        )
      )
    )

    return { scheduled: true }
  } catch (err) {
    logger.error(
      { err, orderNumber: order.orderNumber },
      'Could not schedule the escalation for this order — it will not be chased'
    )
    return { scheduled: false }
  }
}

/**
 * Called when an order is acknowledged, i.e. when it leaves `placed`. Never throws.
 *
 * Best-effort by design: the worker re-checks the order's status anyway, so a cancel
 * that fails costs nothing but a job that wakes up and decides to do nothing.
 */
export async function cancelOrderEscalation(orderId) {
  const q = getQueue()
  if (!q) return

  await Promise.all(
    LEVELS.map(async ({ level }) => {
      try {
        const job = await q.getJob(jobId(orderId, level))
        // `remove` throws on a job that is already running or already gone, and both are
        // fine — the status re-check is what actually stops the message.
        if (job) await job.remove()
      } catch {
        // Deliberately swallowed. See above.
      }
    })
  )
}

/** The work itself, exported so it can be tested without a Redis instance. */
export async function processEscalation({ orderId, level, waitedMinutes }, deps = {}) {
  const notify = deps.notify ?? notifyOrderUnacknowledged

  const order = await Order.findById(orderId).populate('branchId', 'code name phone')

  if (!order) {
    // Deleted, or never existed. Nothing to chase and nothing to fix.
    return { sent: false, reason: 'order-not-found' }
  }

  /**
   * The authoritative check, and the reason this cannot rely on cancellation alone.
   * Somebody confirming an order a second before this fires must not be chased about it.
   */
  if (order.status !== ORDER_STATUS.PLACED) {
    return { sent: false, reason: 'already-acknowledged' }
  }

  const branch = order.branchId
  const to = recipientFor(level, branch)

  if (!to) {
    logger.warn(
      { orderNumber: order.orderNumber, level },
      'Order is unacknowledged but there is no number to chase — check the branch phone'
    )
    return { sent: false, reason: 'no-recipient' }
  }

  logger.warn(
    { orderNumber: order.orderNumber, level, waitedMinutes },
    'Order still unacknowledged — escalating'
  )

  await notify({ order, branch, to, waitedMinutes }, deps.notifyOptions)

  return { sent: true }
}

/**
 * Starts the worker. Safe to call when Redis is absent — it does nothing and says so.
 *
 * The API process runs the worker rather than a separate one. That is the right call at
 * this size: two jobs per order on a four-branch shop is not load, and a second process
 * is a second thing to deploy, monitor and forget to restart. If the queue ever grows
 * past this, moving it out is a file move rather than a rewrite.
 */
export function startOrderEscalation() {
  const connection = getRedis()

  if (!connection) {
    if (!env.isDevelopment) {
      logger.warn(
        'ORDER ESCALATION: REDIS_URL is not set, so unacknowledged orders will NOT be ' +
          'chased. An order nobody opens will sit in `placed` until a customer rings to ' +
          'ask where it is.'
      )
    }
    return null
  }

  worker = new Worker(QUEUE_NAME, (job) => processEscalation(job.data), {
    connection,
    // Two branches could plausibly be chased at the same instant; beyond that this is a
    // trickle, and a high concurrency only means more idle connections.
    concurrency: 4,
  })

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Order escalation job failed')
  })

  logger.info('Order escalation worker started')
  return worker
}

/** Stops the worker on shutdown. Safe when it never started. */
export async function stopOrderEscalation() {
  if (worker) {
    await worker.close()
    worker = null
  }

  if (queue) {
    await queue.close()
    queue = null
  }
}
