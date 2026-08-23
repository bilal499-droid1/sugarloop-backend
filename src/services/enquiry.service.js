import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { Enquiry } from '../models/Enquiry.js'
import { ENQUIRY_KIND } from '../config/constants.js'
import { sendEmail } from './email.service.js'
import { notifyEnquiryReceived } from './notification.service.js'

/**
 * The subject says which queue this belongs to, because the shop's inbox is where both
 * land and a sales lead deserves a different reaction from a question about nut
 * allergies. Someone scanning unread subjects should be able to tell without opening one.
 */
const SUBJECTS = Object.freeze({
  [ENQUIRY_KIND.CORPORATE]: 'Corporate gifting enquiry',
  [ENQUIRY_KIND.QUESTION]: 'Question from the website',
})

/** What lands in the shop's inbox. Plain text on purpose — it is read, not admired. */
function notificationBody(enquiry) {
  const lines = [`Name:     ${enquiry.name}`]

  // Optional on a question, and an empty "Phone:" line reads as a number that failed to
  // save rather than one that was never asked for.
  if (enquiry.phone) lines.push(`Phone:    ${enquiry.phone}`)

  lines.push(`Email:    ${enquiry.email}`)

  if (enquiry.company) lines.push(`Company:  ${enquiry.company}`)
  if (enquiry.subject) lines.push(`Subject:  ${enquiry.subject}`)
  if (enquiry.message) lines.push('', 'Message:', enquiry.message)

  lines.push(
    '',
    '—',
    `Reply directly to this email to reach ${enquiry.name}.`,
    `Received ${enquiry.createdAt.toISOString()} · reference ${enquiry.id}`
  )

  return lines.join('\n')
}

/**
 * Records a corporate gifting enquiry and tells the shop about it.
 *
 * **The write comes first and the email second, and the email is not allowed to fail the
 * request.** The customer has already typed everything they know about a job worth
 * chasing; losing that because Gmail was briefly unreachable — and telling them the form
 * is broken so they retype it — is a worse outcome than a notification that arrives late.
 * A failed send leaves `emailedAt` null, which is the flag for "nobody has been told
 * about this one yet", and logs loudly so it is visible in the log stream rather than
 * only discoverable by querying.
 *
 * This mirrors `audit.service.js`, which takes the same position for the same reason: the
 * thing being recorded already happened, so reporting failure would be a lie.
 *
 * `send` is injectable for the tests. ES module exports are frozen bindings, so the
 * alternative is either a mocking loader hook or letting the suite talk to a real mail
 * server — and the rule most worth testing here is precisely what happens when that send
 * throws. Same shape as the `{ now }` seam in `customerAuth.service.js`.
 */
export async function create(
  input,
  { ip = '', userAgent = '' } = {},
  { send = sendEmail, notifications = undefined } = {}
) {
  const enquiry = await Enquiry.create({ ...input, meta: { ip, userAgent } })

  try {
    await send({
      to: env.ENQUIRY_NOTIFY_EMAIL,
      subject: `${SUBJECTS[enquiry.kind] ?? SUBJECTS[ENQUIRY_KIND.CORPORATE]}${
        enquiry.company ? ` — ${enquiry.company}` : ''
      }`,
      text: notificationBody(enquiry),
      // So hitting reply in the shop's inbox writes to the customer rather than to
      // the shop itself.
      replyTo: enquiry.email,
    })

    enquiry.emailedAt = new Date()
    await enquiry.save()
  } catch (err) {
    logger.error(
      { err, enquiryId: String(enquiry._id), email: enquiry.email },
      'Corporate enquiry saved but the notification email failed to send'
    )
  }

  // A second nudge on the same event, on a channel someone actually watches. The email
  // carries the whole message and can be replied to; this is the one that gets seen
  // within the hour. It never throws — see notification.service.js — so it needs no
  // try/catch of its own, and a WhatsApp outage cannot cost the shop the lead.
  await notifyEnquiryReceived(enquiry, notifications)

  return enquiry
}
