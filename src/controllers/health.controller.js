import mongoose from 'mongoose'
import { ok } from '../views/respond.js'
import { env } from '../config/env.js'

const startedAt = Date.now()

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting']

/**
 * Liveness — "is the process up?". Never touches the database, so a database blip
 * doesn't cause Render to kill and restart an otherwise healthy container.
 */
export function live(_req, res) {
  return ok(res, {
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    environment: env.NODE_ENV,
  })
}

/**
 * Readiness — "can this instance actually serve requests?". Checks the database and
 * returns 503 when it can't, which is the signal a load balancer should act on.
 */
export function ready(_req, res) {
  const state = DB_STATES[mongoose.connection.readyState] ?? 'unknown'
  const isReady = mongoose.connection.readyState === 1

  return res.status(isReady ? 200 : 503).json({
    data: {
      status: isReady ? 'ready' : 'not_ready',
      database: state,
    },
  })
}
