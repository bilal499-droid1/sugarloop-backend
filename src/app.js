import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/**
 * Where `npm run build:web` leaves the compiled shop.
 *
 * Gitignored, and absent in a fresh clone — which is why every use of it below is
 * guarded. The API has to keep running on its own for the test suite, for `npm run dev`,
 * and for anyone who never touches the frontend. A missing build degrades to "API only",
 * never to a crash at boot.
 *
 * Read once, at import. A build produced while the server is running needs a restart to
 * be picked up, which is what a deploy does anyway.
 */
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const frontendIndex = path.join(publicDir, 'index.html')
const hasFrontend = fs.existsSync(frontendIndex)

export function createApp() {
  const app = express()

  // Render terminates TLS at its proxy, so without this every client looks like it
  // shares one IP — which would make per-IP rate limiting either useless or a
  // global outage. Trust exactly one hop, not `true`, which lets a caller spoof
  // X-Forwarded-For and bypass the limiter entirely.
  //
  // ⚠️ The number is the count of proxies that actually sit in front of this process.
  // One is correct behind a single reverse proxy (Caddy, nginx, an ALB). Expose Node
  // straight to the internet and it must be 0: with nothing rewriting the header, any
  // caller can send their own X-Forwarded-For and draw a fresh rate-limit budget on
  // every request — including against the OTP limiter, which is the control standing
  // between a script and the client's messaging bill.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(requestId)

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: {
        // Health checks fire constantly and would bury real traffic. Frontend assets are
        // worse: one page load pulls around a hundred of them, so logging each would
        // turn the log into a list of .webp files with the occasional order lost in it.
        ignore: (req) =>
          req.url.startsWith('/api/v1/health') || req.url.startsWith('/assets/'),
      },
    })
  )

  // CSP is off. It used to be off because nothing here rendered HTML; now that this
  // serves the shop, it is off because the built pages pull fonts from api.fontshare.com
  // and fonts.googleapis.com, and helmet's default policy blocks them silently — the site
  // renders in a fallback serif and nothing in the logs says why. Switching it on is
  // worth doing and needs those origins allowlisted and a pass over a real build, so it
  // is its own change rather than a side effect of this one.
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

  /**
   * The built frontend, served from the same origin as the API.
   *
   * **Mounted above `generalLimiter`, deliberately.** That limiter allows 300 requests a
   * minute per IP and one page load pulls roughly a hundred hashed assets, so counting
   * them would rate-limit a real customer off the shop after three page views. The
   * limiter exists to stop a runaway caller hammering the API; a .webp is not the API.
   *
   * Above the body parsers for the same reason — a GET for an image has no body worth
   * inspecting.
   *
   * `index: false` because the SPA fallback further down serves index.html, and its
   * caching rules should live in exactly one place.
   */
  if (hasFrontend) {
    app.use(
      express.static(publicDir, {
        index: false,
        setHeaders(res, filePath) {
          // Vite fingerprints everything under /assets (index-KxS2bPZA.js), so the bytes
          // behind a given URL can never change — cache them for a year. Everything else
          // must revalidate, or a deploy leaves browsers asking for asset hashes the
          // last build deleted.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          } else {
            res.setHeader('Cache-Control', 'no-cache')
          }
        },
      })
    )
  }

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

  /**
   * Client-side routing.
   *
   * React Router owns `/products`, the checkout and the staff console. On a refresh or a
   * shared link the browser asks this server for those paths directly, and without a
   * fallback they reach `notFoundHandler` and return the API's JSON 404 to somebody who
   * expected a shop. Vercel did this with the rewrite in `vercel.json`; on Express it has
   * to be said out loud.
   *
   * GET only, and never for `/api` — an unknown API route must stay a JSON 404 rather
   * than become a page, or every mistyped fetch in the frontend surfaces as "unexpected
   * token <" instead of the 404 it actually is.
   */
  if (hasFrontend) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      // Same reasoning as the static handler: this document names the hashed bundles, so
      // a cached copy points at files the next deploy removes.
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(frontendIndex)
    })
  }

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
