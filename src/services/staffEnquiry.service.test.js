import test from 'node:test'
import assert from 'node:assert/strict'

import { Enquiry } from '../models/Enquiry.js'
import { StaffUser } from '../models/StaffUser.js'
import { AuditLog } from '../models/AuditLog.js'
import { ENQUIRY_STATUS, STAFF_ROLE } from '../config/constants.js'
import * as staffEnquiryService from './staffEnquiry.service.js'
import { staffEnquiryView } from '../views/enquiryView.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * The corporate enquiries inbox.
 *
 * SKIPS rather than fails when Mongo is unreachable, matching the other integration
 * suites. See testing/mongoTestDb.js.
 */
const { connected, skip } = await connectTestDatabase('staffEnquiry')

let admin

const lead = (overrides = {}) => ({
  name: 'Ayesha Khan',
  phone: '+92 51 111 557 799',
  email: 'ayesha@examplecorp.pk',
  company: 'Example Corp',
  subject: 'Eid gifting',
  message: '200 boxes of 6.',
  emailedAt: new Date(),
  ...overrides,
})

async function seedFixtures() {
  await Promise.all([Enquiry.deleteMany({}), StaffUser.deleteMany({}), AuditLog.deleteMany({})])

  admin = await StaffUser.create({
    name: 'Sugarloop Admin',
    email: 'admin@sugarloop.pk',
    passwordHash: 'FixturePassw0rd!',
    role: STAFF_ROLE.ADMIN,
    branchId: null,
  })
}

const asAdmin = () => ({ actor: admin, ip: '127.0.0.1' })

test('corporate enquiries inbox', { skip, concurrency: false }, async (t) => {
  t.after(() => disconnectTestDatabase(connected))
  t.beforeEach(seedFixtures)

  await t.test('lists newest first', async () => {
    await Enquiry.create(lead({ company: 'First' }))
    await Enquiry.create(lead({ company: 'Second' }))
    await Enquiry.create(lead({ company: 'Third' }))

    const { items } = await staffEnquiryService.list({ limit: 50 })
    assert.deepEqual(
      items.map((row) => row.company),
      ['Third', 'Second', 'First']
    )
  })

  await t.test('finds the leads nobody was told about', async () => {
    await Enquiry.create(lead({ company: 'Emailed fine' }))
    await Enquiry.create(lead({ company: 'Mailer was down', emailedAt: null }))

    const { items } = await staffEnquiryService.list({ emailed: false, limit: 50 })
    assert.deepEqual(
      items.map((row) => row.company),
      ['Mailer was down']
    )

    const sent = await staffEnquiryService.list({ emailed: true, limit: 50 })
    assert.deepEqual(
      sent.items.map((row) => row.company),
      ['Emailed fine']
    )
  })

  await t.test('searches name, email, company and phone', async () => {
    await Enquiry.create(lead({ name: 'Bilal Ahmed', company: 'Nadir Trading' }))
    await Enquiry.create(lead({ company: 'Example Corp', email: 'buyer@othercorp.pk' }))

    for (const [term, expected] of [
      ['bilal', 'Nadir Trading'],
      ['NADIR', 'Nadir Trading'],
      ['othercorp', 'Example Corp'],
      ['557 799', 'Nadir Trading'],
    ]) {
      const { items } = await staffEnquiryService.list({ search: term, limit: 50 })
      assert.ok(
        items.some((row) => row.company === expected),
        `"${term}" should find ${expected}`
      )
    }
  })

  await t.test('a regex metacharacter in the search is a literal, not a pattern', async () => {
    await Enquiry.create(lead({ company: 'Example Corp' }))

    // Unescaped, '.' matches any character and this would return everything.
    const { items } = await staffEnquiryService.list({ search: 'E.a.p.e', limit: 50 })
    assert.equal(items.length, 0)
  })

  await t.test('filters by status', async () => {
    await Enquiry.create(lead({ company: 'Untouched' }))
    await Enquiry.create(lead({ company: 'Rung already', status: ENQUIRY_STATUS.CONTACTED }))

    const { items } = await staffEnquiryService.list({ status: ENQUIRY_STATUS.NEW, limit: 50 })
    assert.deepEqual(
      items.map((row) => row.company),
      ['Untouched']
    )
  })

  await t.test('pages with a cursor rather than an offset', async () => {
    for (let i = 0; i < 3; i += 1) await Enquiry.create(lead({ company: `Co ${i}` }))

    const first = await staffEnquiryService.list({ limit: 2 })
    assert.equal(first.items.length, 2)
    assert.ok(first.nextCursor)

    const second = await staffEnquiryService.list({ limit: 2, cursor: first.nextCursor })
    assert.equal(second.items.length, 1)
    assert.equal(second.nextCursor, null)

    const seen = [...first.items, ...second.items].map((row) => String(row._id))
    assert.equal(new Set(seen).size, 3, 'no row appears on both pages')
  })

  await t.test('counts for the filter chips', async () => {
    await Enquiry.create(lead())
    await Enquiry.create(lead({ status: ENQUIRY_STATUS.CONTACTED }))
    await Enquiry.create(lead({ status: ENQUIRY_STATUS.CLOSED, emailedAt: null }))

    const summary = await staffEnquiryService.summary()
    assert.equal(summary.new, 1)
    assert.equal(summary.contacted, 1)
    assert.equal(summary.closed, 1)
    assert.equal(summary.unemailed, 1)
    assert.equal(summary.total, 3)
  })

  await t.test('records a status change and who made it', async () => {
    const created = await Enquiry.create(lead())

    const updated = await staffEnquiryService.update(
      created._id,
      { status: ENQUIRY_STATUS.CONTACTED, note: 'Called, wants a quote by Friday.' },
      asAdmin()
    )

    assert.equal(updated.status, ENQUIRY_STATUS.CONTACTED)
    assert.equal(updated.notes.length, 1)
    assert.equal(updated.notes[0].text, 'Called, wants a quote by Friday.')
    assert.equal(updated.notes[0].byName, 'Sugarloop Admin')
    assert.equal(String(updated.notes[0].by), String(admin._id))

    const entry = await AuditLog.findOne({ action: 'enquiry.update' })
    assert.ok(entry)
    assert.equal(entry.actorEmail, 'admin@sugarloop.pk')
    assert.deepEqual(entry.changes.status, { from: 'new', to: 'contacted' })
  })

  await t.test('notes accumulate rather than replace', async () => {
    const created = await Enquiry.create(lead())

    await staffEnquiryService.update(created._id, { note: 'Rang, no answer.' }, asAdmin())
    await staffEnquiryService.update(
      created._id,
      { note: 'Rang again, spoke to reception.' },
      asAdmin()
    )

    const enquiry = await staffEnquiryService.getById(created._id)
    assert.equal(enquiry.notes.length, 2)
    assert.equal(enquiry.notes[0].text, 'Rang, no answer.')
    assert.equal(enquiry.notes[1].text, 'Rang again, spoke to reception.')
    // Untouched: a note on its own is not a status change.
    assert.equal(enquiry.status, ENQUIRY_STATUS.NEW)
  })

  await t.test('a note without a status change still leaves an audit row', async () => {
    const created = await Enquiry.create(lead())
    await staffEnquiryService.update(created._id, { note: 'Left a voicemail.' }, asAdmin())

    const entry = await AuditLog.findOne({ action: 'enquiry.update' })
    assert.ok(entry)
    assert.equal(entry.changes.noteAdded, true)
    assert.equal(entry.changes.status, undefined)
  })

  await t.test('the note text is never copied into the audit trail', async () => {
    const created = await Enquiry.create(lead())
    await staffEnquiryService.update(
      created._id,
      { note: 'Their budget is 400,000 rupees.' },
      asAdmin()
    )

    const entry = await AuditLog.findOne({ action: 'enquiry.update' })
    assert.equal(
      JSON.stringify(entry.toObject()).includes('400,000'),
      false,
      'the note lives on the enquiry, not duplicated into the audit log'
    )
  })

  await t.test('a missing enquiry is a 404, not a crash', async () => {
    const missing = '0'.repeat(24)
    await assert.rejects(staffEnquiryService.getById(missing), (error) => {
      assert.equal(error.statusCode, 404)
      return true
    })
    await assert.rejects(
      staffEnquiryService.update(missing, { note: 'x' }, asAdmin()),
      (error) => {
        assert.equal(error.statusCode, 404)
        return true
      }
    )
  })

  await t.test('the staff view shows the trail but never the submitter metadata', async () => {
    const created = await Enquiry.create(
      lead({ meta: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0' } })
    )
    await staffEnquiryService.update(created._id, { note: 'Called.' }, asAdmin())

    const view = staffEnquiryView(await staffEnquiryService.getById(created._id))

    assert.equal(view.company, 'Example Corp')
    assert.equal(view.emailed, true)
    assert.equal(view.notes.length, 1)
    assert.match(view.reference, /^[0-9A-F]{8}$/)

    assert.equal(view.meta, undefined)
    assert.equal(JSON.stringify(view).includes('203.0.113.9'), false)
    assert.equal(JSON.stringify(view).includes('Mozilla'), false)
  })

  await t.test('`emailed` is false when the notification never got out', async () => {
    const created = await Enquiry.create(lead({ emailedAt: null }))
    const view = staffEnquiryView(await staffEnquiryService.getById(created._id))

    assert.equal(view.emailed, false)
    assert.equal(view.emailedAt, null)
  })
})
