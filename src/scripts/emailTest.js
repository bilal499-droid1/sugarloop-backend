/**
 * Proves the mailer works, before a real customer's enquiry depends on it.
 *
 *   npm run email:test                  → sends to ENQUIRY_NOTIFY_EMAIL
 *   npm run email:test you@example.com  → sends somewhere else
 *
 * Exists because the alternative way to find out whether SMTP is configured correctly is
 * to submit the corporate form and wait to see if anything arrives — and when nothing
 * does, there is no way to tell a wrong app password from a blocked port from a typo in
 * the address. The service deliberately swallows send failures so a lead is never lost to
 * one, which is right for a customer request and useless for debugging. This script does
 * the opposite: it fails loudly and says exactly what went wrong.
 */
import { env } from '../config/env.js'
import { sendEmail } from '../services/email.service.js'

const to = process.argv[2] ?? env.ENQUIRY_NOTIFY_EMAIL

/**
 * Nodemailer surfaces the provider's error code and very little else. `EAUTH` in
 * particular is what Gmail returns both for a wrong password AND for using the account's
 * real password instead of an app password — which is the mistake almost everyone makes
 * first, and the message does not say so.
 */
const DIAGNOSIS = {
  EAUTH: [
    'The server rejected the username or password.',
    '',
    'The usual cause is using the account password instead of an APP PASSWORD.',
    'Gmail will not accept the real password here, whatever it is.',
    '',
    'To generate one:',
    '  1. Go to https://myaccount.google.com/security signed in as ' + (env.SMTP_USER ?? 'the shop account'),
    '  2. Turn on 2-Step Verification if it is not already on — app passwords',
    '     do not exist as an option until it is',
    '  3. Go to https://myaccount.google.com/apppasswords',
    '  4. Create one named e.g. "Sugarloop API"',
    '  5. Copy the 16 characters (spaces do not matter) into SMTP_PASSWORD in .env',
  ],
  ECONNECTION: [
    'Could not reach the mail server at all.',
    '',
    'Check SMTP_HOST and SMTP_PORT. For Gmail: smtp.gmail.com and 587.',
    'Some networks and hosting providers block outbound port 587 or 465 —',
    'if this works on your laptop but not on the server, that is usually why.',
  ],
  ETIMEDOUT: [
    'The connection timed out.',
    '',
    'Same likely cause as ECONNECTION: a firewall between here and the mail server.',
  ],
  EENVELOPE: [
    'The message was rejected because of the addresses on it.',
    '',
    'Check EMAIL_FROM is an address this SMTP account is allowed to send as.',
  ],
}

function line(char = '─') {
  return char.repeat(64)
}

console.log(`\n${line()}`)
console.log('  Sugarloop email check')
console.log(line())
console.log(`  EMAIL_TRANSPORT  ${env.EMAIL_TRANSPORT}`)
console.log(`  SMTP_HOST        ${env.SMTP_HOST ?? '(not set)'}`)
console.log(`  SMTP_PORT        ${env.SMTP_PORT}`)
console.log(`  SMTP_USER        ${env.SMTP_USER ?? '(not set)'}`)
// Never the value. Whether it is set is the only useful, safe thing to report.
console.log(`  SMTP_PASSWORD    ${env.SMTP_PASSWORD ? 'set' : '(not set)'}`)
console.log(`  EMAIL_FROM       ${env.EMAIL_FROM}`)
console.log(`  Sending to       ${to}`)
console.log(`${line()}\n`)

if (env.EMAIL_TRANSPORT === 'log') {
  console.log('EMAIL_TRANSPORT is `log`, so this will print the message and send NOTHING.')
  console.log('That is the development default. Set EMAIL_TRANSPORT=smtp in .env to send')
  console.log('for real — and note the server refuses to boot on smtp until SMTP_HOST,')
  console.log('SMTP_USER and SMTP_PASSWORD are all filled in.\n')
}

try {
  const result = await sendEmail({
    to,
    subject: 'Sugarloop email check',
    replyTo: env.SMTP_USER,
    text: [
      'This is a test from the Sugarloop API.',
      '',
      'If you are reading it in an inbox, corporate gifting enquiries will arrive too:',
      'the storefront form posts to POST /enquiries, which stores the lead and then sends',
      'a message exactly like this one — with the customer as Reply-To, so hitting reply',
      'writes to them rather than to yourself.',
      '',
      `Sent ${new Date().toISOString()} · transport ${env.EMAIL_TRANSPORT}`,
    ].join('\n'),
  })

  if (result.transport === 'log') {
    console.log('Printed above. Nothing was sent — see the note about EMAIL_TRANSPORT.\n')
  } else {
    console.log(`✓ Sent. Message id: ${result.messageId}`)
    console.log(`  Check ${to} — including its spam folder the first time.\n`)
  }

  process.exit(0)
} catch (error) {
  console.error(`\n✗ Send FAILED: ${error.message}\n`)

  const diagnosis = DIAGNOSIS[error.code]
  if (diagnosis) {
    console.error(line())
    diagnosis.forEach((l) => console.error(`  ${l}`))
    console.error(`${line()}\n`)
  } else if (error.code) {
    console.error(`  Provider error code: ${error.code}\n`)
  }

  process.exit(1)
}
