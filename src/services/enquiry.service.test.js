import test from 'node:test'
import assert from 'node:assert/strict'

import { Enquiry } from '../models/Enquiry.js'
import { ENQUIRY_KIND, ENQUIRY_STATUS } from '../config/constants.js'
import * as enquiryService from './enquiry.service.js'
import { createEnquirySchema } from '../validators/enquiry.validator.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Corporate gifting leads.
 *
 * The rule worth the most coverage here is the one that is easy to get backwards: the
 * notification email must never be able to fail the request, because the lead is already
 * saved by then and telling the customer it failed makes them retype it or give up.
 *
 * SKIPS rather than fails when Mongo is unreachable, matching the other integration
 * suites. See testing/mongoTestDb.js.
 */
const { connected, skip } = await connectTestDatabase('enquiry')

const VALID = {
  name: 'Ayesha Khan',
  phone: '+92 51 111 557 799',
  email: 'ayesha@examplecorp.pk',
  company: 'Example Corp',
  subject: 'Eid gifting, 200 boxes',
  message: 'We would like 200 boxes of 6 delivered to our head office before Eid.',
}

test('corporate enquiries', { skip, concurrency: false }, async (t) => {
  t.after(() => disconnectTestDatabase(connected))
  t.beforeEach(() => Enquiry.deleteMany({}))

  await t.test('stores the lead and records that it was emailed', async () => {
    const sent = []
    const send = async (message) => {
      sent.push(message)
      return { transport: 'test', messageId: 'x' }
    }

    const enquiry = await enquiryService.create(
      VALID,
      { ip: '1.2.3.4', userAgent: 'test' },
      { send }
    )

    assert.equal(enquiry.name, 'Ayesha Khan')
    assert.equal(enquiry.status, ENQUIRY_STATUS.NEW)
    assert.ok(enquiry.emailedAt, 'emailedAt is stamped once the notification is away')

    assert.equal(sent.length, 1)
    assert.match(sent[0].subject, /Example Corp/)
    assert.equal(
      sent[0].replyTo,
      'ayesha@examplecorp.pk',
      'reply goes to the customer, not the shop'
    )
    assert.match(sent[0].text, /200 boxes/)
  })

  await t.test('a failed email does NOT lose the lead', async () => {
    const send = async () => {
      throw new Error('SMTP is down')
    }

    // The whole point: this resolves rather than throwing.
    const enquiry = await enquiryService.create(VALID, {}, { send })

    const stored = await Enquiry.findById(enquiry._id)
    assert.ok(stored, 'the lead survives a mailer outage')
    assert.equal(stored.emailedAt, null, 'and is flagged as nobody-has-been-told')
    assert.equal(stored.email, 'ayesha@examplecorp.pk')
  })

  await t.test('never stores anything the form did not send', async () => {
    const send = async () => ({ transport: 'test' })

    const enquiry = await enquiryService.create(
      {
        name: 'Minimal',
        phone: '03001234567',
        email: 'minimal@example.pk',
        company: '',
        subject: '',
        message: '',
      },
      {},
      { send }
    )

    assert.equal(enquiry.company, '')
    assert.equal(enquiry.subject, '')
    assert.equal(enquiry.message, '')
  })

  await t.test('the notification names the customer and how to reach them', async () => {
    let body = ''
    const send = async (message) => {
      body = message.text
      return { transport: 'test' }
    }

    await enquiryService.create(VALID, {}, { send })

    assert.match(body, /Ayesha Khan/)
    assert.match(body, /\+92 51 111 557 799/)
    assert.match(body, /ayesha@examplecorp\.pk/)
  })

  /**
   * FAQ questions share this collection with corporate leads, so the rules worth
   * covering are the ones that differ: a phone number is the point of a sales lead and
   * an obstacle on a question.
   */
  await t.test('a question stores without a phone and emails its own subject', async () => {
    const sent = []
    const send = async (message) => {
      sent.push(message)
      return { transport: 'test', messageId: 'x' }
    }

    const enquiry = await enquiryService.create(
      createEnquirySchema.parse({
        kind: ENQUIRY_KIND.QUESTION,
        name: 'Bilal',
        email: 'bilal@example.pk',
        message: 'Do the crafted donuts contain nuts?',
      }),
      { ip: '1.2.3.4', userAgent: 'test' },
      { send }
    )

    assert.equal(enquiry.kind, ENQUIRY_KIND.QUESTION)
    assert.equal(enquiry.phone, '')
    assert.equal(enquiry.status, ENQUIRY_STATUS.NEW)
    assert.ok(enquiry.emailedAt, 'the send succeeded, so it is recorded')

    assert.match(sent[0].subject, /Question from the website/)
    // An empty "Phone:" line reads as a number that failed to save.
    assert.ok(!sent[0].text.includes('Phone:'), 'no blank phone line on a question')
    assert.match(sent[0].text, /Do the crafted donuts contain nuts\?/)
  })

  await t.test('a question survives the notification email failing', async () => {
    const failing = async () => {
      throw new Error('SMTP is down')
    }

    const enquiry = await enquiryService.create(
      createEnquirySchema.parse({
        kind: ENQUIRY_KIND.QUESTION,
        name: 'Bilal',
        email: 'bilal@example.pk',
        message: 'Do the crafted donuts contain nuts?',
      }),
      {},
      { send: failing }
    )

    const stored = await Enquiry.findById(enquiry._id)
    assert.ok(stored, 'the question is the record; the email is only the notification')
    assert.equal(stored.emailedAt, null, 'flagged as nobody-has-been-told')
  })
})

/** Schema-level, so these run with or without a database. */
test('createEnquirySchema', async (t) => {
  await t.test('accepts the minimum a real lead would send', () => {
    const result = createEnquirySchema.safeParse({
      name: 'Someone',
      phone: '03001234567',
      email: 'someone@example.pk',
    })

    assert.equal(result.success, true)
    // Optional fields default to empty strings rather than undefined, so the model never
    // has to decide what a missing company means.
    assert.equal(result.data.company, '')
    assert.equal(result.data.message, '')
  })

  await t.test('accepts a landline or UAN, unlike the customer phone rules', () => {
    // A company's switchboard is not a Pakistani mobile, and refusing a corporate lead
    // over the shape of its number would be the wrong trade.
    for (const phone of ['+92 51 111 557 799', '051-2345678', '+922111123456']) {
      assert.equal(
        createEnquirySchema.safeParse({ name: 'X', phone, email: 'a@b.pk' }).success,
        true,
        `${phone} should be accepted`
      )
    }
  })

  await t.test('requires a usable email — it is the reply channel', () => {
    const result = createEnquirySchema.safeParse({
      name: 'Someone',
      phone: '03001234567',
      email: 'not-an-email',
    })

    assert.equal(result.success, false)
    assert.equal(result.error.issues[0].path[0], 'email')
  })

  await t.test('rejects an empty name and a nonsense phone', () => {
    assert.equal(
      createEnquirySchema.safeParse({ name: '   ', phone: '03001234567', email: 'a@b.pk' })
        .success,
      false
    )
    assert.equal(
      createEnquirySchema.safeParse({ name: 'X', phone: 'call me', email: 'a@b.pk' }).success,
      false
    )
  })

  await t.test('caps the message so the form cannot be used to store a novel', () => {
    assert.equal(
      createEnquirySchema.safeParse({
        name: 'X',
        phone: '03001234567',
        email: 'a@b.pk',
        message: 'a'.repeat(2001),
      }).success,
      false
    )
  })

  /**

  /** The two kinds diverge on which fields are mandatory. */
  await t.test('a question is accepted with no phone number', () => {
    const result = createEnquirySchema.safeParse({
      kind: ENQUIRY_KIND.QUESTION,
      name: 'Bilal',
      email: 'bilal@example.pk',
      message: 'Do the crafted donuts contain nuts?',
    })

    assert.equal(result.success, true)
  })

  await t.test('a corporate lead still demands a phone number', () => {
    const result = createEnquirySchema.safeParse({
      kind: ENQUIRY_KIND.CORPORATE,
      name: 'Ayesha',
      email: 'a@b.pk',
    })

    assert.equal(result.success, false)
    assert.equal(result.error.issues[0].path[0], 'phone')
  })

  await t.test('a question with nothing in it is rejected', () => {
    // The corporate form is deliberately looser, but there is nothing here to answer.
    const result = createEnquirySchema.safeParse({
      kind: ENQUIRY_KIND.QUESTION,
      name: 'Bilal',
      email: 'bilal@example.pk',
    })

    assert.equal(result.success, false)
    assert.equal(result.error.issues[0].path[0], 'message')
  })

  await t.test('defaults to corporate when the form does not say', () => {
    // The corporate form predates `kind` and does not send it. It must keep working.
    const parsed = createEnquirySchema.parse({
      name: 'Ayesha',
      phone: '03001234567',
      email: 'a@b.pk',
    })

    assert.equal(parsed.kind, ENQUIRY_KIND.CORPORATE)
  })
})
