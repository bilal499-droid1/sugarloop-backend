import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import pinoHttp from 'pino-http'

import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { requestId } from './middleware/requestId.js'
import { generalLimiter } from './middleware/rateLimit.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import routes from './routes/index.js'

export function createApp() {
  const app = express()

  // Render terminates TLS at its proxy, so without this every client looks like it
  // shares one IP — which would make per-IP rate limiting either useless or a
  // global outage. Trust exactly one hop, not `true`, which lets a caller spoof
  // X-Forwarded-For and bypass the limiter entirely.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(requestId)

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: {
        // Health checks fire constantly and would bury real traffic.
        ignore: (req) => req.url.startsWith('/api/v1/health'),
      },
    })
  )

  // This is a JSON API with no browser-rendered HTML, so the CSP and embedder
  // policies helmet enables by default protect nothing and complicate responses.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: server-to-server, curl, health checks. Allowed —
        // CORS is a browser protection and these aren't browsers.
        if (!origin) return callback(null, true)
        if (env.corsOrigins.includes(origin)) return callback(null, true)
        return callback(new Error(`Origin ${origin} is not allowed by CORS`))
      },
      credentials: true, // customer session travels in an httpOnly cookie
      exposedHeaders: ['x-request-id'],
    })
  )

  app.use(compression())

  // 100kb is generous for the largest realistic payload (a 12-item box order) and
  // small enough that a junk body is rejected before it costs memory.
  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: false, limit: '100kb' }))

  // Staff refresh tokens and the customer session both travel as httpOnly cookies,
  // which Express does not parse on its own. Unsigned: the cookie values are already
  // unguessable random tokens verified against the database, so a signature would add
  // a second secret to rotate and prove nothing the lookup doesn't already prove.
  app.use(cookieParser())

  app.use(generalLimiter)

  app.use('/api/v1', routes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
