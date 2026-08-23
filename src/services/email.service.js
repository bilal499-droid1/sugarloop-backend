/**
 * Outbound email.
 *
 * A swappable transport, the same shape as `otpDelivery.service.js`, and for the same
 * reason: the feature that needs it is finished now, and the account that sends it is the
 * client's to create. Chosen by `EMAIL_TRANSPORT`.
 *
 *   log    writes the whole message to the server console and sends nothing. The
 *          development default, and refused at boot in production.
 *   smtp   real delivery through nodemailer. Needs SMTP_HOST / SMTP_PORT / SMTP_USER /
 *          SMTP_PASSWORD.
 *
 * Unlike WhatsApp — which is blocked behind a Meta Business account and per-template
 * approval — `smtp` is genuinely reachable today: the client already has
 * `sugarlooppk@gmail.com`, and Gmail issues an app password in about two minutes. So this
 * one is implemented rather than stubbed, and switching it on is filling in four
 * environment variables.
 */
import nodemailer from 'nodemailer'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { ApiError } from '../utils/ApiError.js'

/**
 * Built once and reused. Nodemailer pools connections per transporter, so creating one
 * per message would open a fresh TCP+TLS handshake to Gmail every time — slow, and a
 * reliable way to get an IP rate-limited.
 */
let transporter = null

function smtpTransporter() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; 587 and 25 start plaintext and upgrade via STARTTLS.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  })

  return transporter
}

/**
 * Development transport: print it and move on.
 *
 * Deliberately `logger.info` rather than `debug` — someone testing the corporate form
 * needs to find this without changing the log level.
 */
async function sendViaLog({ to, subject, text, replyTo }) {
  logger.info(
    `\n  ┌─ EMAIL (not sent — EMAIL_TRANSPORT=log) ──────────────\n` +
      `  │  To:       ${to}\n` +
      `  │  Reply-To: ${replyTo ?? '(none)'}\n` +
      `  │  Subject:  ${subject}\n` +
      `  └───────────────────────────────────────────────────────\n` +
      `${text}\n`
  )

  return { transport: 'log', messageId: null }
}

async function sendViaSmtp({ to, subject, text, replyTo }) {
  const info = await smtpTransporter().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    /**
     * So a reply goes to the customer, not to the shop's own inbox. Without it, hitting
     * "reply" on an enquiry notification mails yourself — which is exactly what someone
     * will do on the first lead that matters.
     */
    ...(replyTo ? { replyTo } : {}),
  })

  return { transport: 'smtp', messageId: info.messageId }
}

const TRANSPORTS = {
  log: sendViaLog,
  smtp: sendViaSmtp,
}

export const AVAILABLE_EMAIL_TRANSPORTS = Object.keys(TRANSPORTS)

/**
 * The `log` transport delivers nothing. In production that means every corporate enquiry
 * is silently dropped while the form tells the customer someone will be in touch — a
 * failure nobody would notice until a client asked why their lead never got a reply.
 */
export function assertEmailTransportIsProductionSafe() {
  if (env.isProduction && env.EMAIL_TRANSPORT === 'log') {
    console.error(
      '\nRefusing to start: EMAIL_TRANSPORT=log in production would drop every ' +
        'corporate enquiry instead of emailing it.\n'
    )
    process.exit(1)
  }
}

export async function sendEmail({ to, subject, text, replyTo }) {
  const send = TRANSPORTS[env.EMAIL_TRANSPORT]
  if (!send) throw ApiError.internal(`Unknown EMAIL_TRANSPORT: ${env.EMAIL_TRANSPORT}`)

  return send({ to, subject, text, replyTo })
}
