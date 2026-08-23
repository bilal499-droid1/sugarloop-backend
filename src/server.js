import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { connectDatabase, disconnectDatabase } from './config/db.js'
import { assertTransportIsProductionSafe } from './services/otpDelivery.service.js'
import { assertGeocoderIsConfigured } from './services/geocoding.service.js'
import { assertEmailTransportIsProductionSafe } from './services/email.service.js'

async function start() {
  // Before anything binds a port: the development OTP transport in production would mean
  // every customer's verification code printed to the logs and no message ever sent.
  // Same reasoning as the JWT placeholder check in config/env.js — refuse to boot.
  assertTransportIsProductionSafe()

  // Likewise GEOCODER=google with no key, which would surface as every delivery address
  // being rejected at checkout rather than as the configuration error it is.
  assertGeocoderIsConfigured()

  // And the development email transport in production, which would drop every corporate
  // enquiry while the form kept telling customers someone would be in touch.
  assertEmailTransportIsProductionSafe()

  await connectDatabase()

  const app = createApp()
  const server = app.listen(env.PORT, () => {
    logger.info(`Sugarloop API listening on port ${env.PORT} [${env.NODE_ENV}]`)
  })

  // Graceful shutdown. Render sends SIGTERM on every deploy; without this, any
  // request in flight is killed mid-write. On an orders API that means an order
  // that took the customer's money-equivalent commitment but never got persisted.
  let shuttingDown = false

  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`${signal} received — shutting down`)

    // Stop accepting new connections, let in-flight requests finish.
    server.close(async () => {
      try {
        await disconnectDatabase()
        logger.info('Shutdown complete')
        process.exit(0)
      } catch (err) {
        logger.error({ err }, 'Error during shutdown')
        process.exit(1)
      }
    })

    // If something is wedged, don't hang the deploy forever.
    setTimeout(() => {
      logger.error('Forced shutdown after 15s timeout')
      process.exit(1)
    }, 15_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // An unhandled rejection leaves the process in an unknown state. Log it, then let
  // the orchestrator restart a clean instance rather than serve from a broken one.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection')
    shutdown('unhandledRejection')
  })

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception')
    process.exit(1)
  })
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server')
  process.exit(1)
})

