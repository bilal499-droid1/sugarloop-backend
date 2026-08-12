import pino from 'pino'
import { env } from './env.js'

// Pretty output locally, newline-delimited JSON in deployed environments so Render's
// log viewer (and later Sentry) can parse fields instead of scraping strings.
export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  redact: {
    // Phone numbers and addresses are PII, and tokens are credentials. None of it
    // belongs in a log line that gets shipped to a third-party log viewer.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.code',
      '*.codeHash',
      '*.otp',
    ],
    censor: '[redacted]',
  },
})
