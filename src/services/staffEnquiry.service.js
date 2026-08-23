/**
 * The corporate enquiries inbox.
 *
 * Read-and-annotate only: nothing here creates or deletes a lead. A lead arrives from the
 * public form and then only ever accumulates history — who called, when, what came of it.
 * Deleting one would remove the evidence that a company ever asked, which is exactly the
 * record this screen exists to keep.
 *
 * Admin-only, enforced at the router. Branch managers have no view of this at all: a
 * corporate gifting lead is not a branch's order, it belongs to whoever runs the shop.
 */
import { Enquiry } from '../models/Enquiry.js'
import { ApiError } from '../utils/ApiError.js'
import { ENQUIRY_KIND, ENQUIRY_STATUS } from '../config/constants.js'
import * as audit from './audit.service.js'

/** User input reaches a regex here, so metacharacters have to stop being metacharacters. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function findOrThrow(id) {
  const enquiry = await Enquiry.findById(id)
  if (!enquiry) throw ApiError.notFound('Enquiry not found')
  return enquiry
}

export async function list({ status, kind, emailed, search, limit, cursor }) {
  const filter = {}
  if (status) filter.status = status
  if (kind) filter.kind = kind
  // `emailedAt: null` is the "nobody has been told about this" case. Written as a null
  // check rather than `$exists` because the field always exists — it is defaulted.
  if (emailed !== undefined) filter.emailedAt = emailed ? { $ne: null } : null

  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i')
    filter.$or = [
      { name: pattern },
      { email: pattern },
      { company: pattern },
      { phone: pattern },
    ]
  }

  // Cursor pagination on _id, matching the order board and the team list. Mongo ObjectIds
  // lead with a timestamp, so descending _id is also newest-first — which is the only
  // order an inbox is ever read in.
  if (cursor) filter._id = { $lt: cursor }

  // One extra row tells us whether another page exists without a second count query.
  const rows = await Enquiry.find(filter).sort({ _id: -1 }).limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
  }
}

/** Counts for the filter chips, so the screen can say "4 new" without fetching 4 pages. */
export async function summary() {
  const [byStatus, byKind, unemailed] = await Promise.all([
    Enquiry.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Enquiry.aggregate([{ $group: { _id: '$kind', count: { $sum: 1 } } }]),
    Enquiry.countDocuments({ emailedAt: null }),
  ])

  const counts = Object.fromEntries(Object.values(ENQUIRY_STATUS).map((value) => [value, 0]))
  for (const row of byStatus) {
    if (row._id in counts) counts[row._id] = row.count
  }

  /**
   * Counted separately rather than nested inside the status breakdown. The screen asks
   * two different questions — "how much is outstanding" and "how much of it is sales" —
   * and a status×kind matrix answers neither without the caller doing arithmetic.
   *
   * Rows written before `kind` existed group under `null`, so they are folded into
   * `corporate`: that is what they were, and the schema default says the same.
   */
  const kinds = Object.fromEntries(Object.values(ENQUIRY_KIND).map((value) => [value, 0]))
  for (const row of byKind) {
    const key = row._id ?? ENQUIRY_KIND.CORPORATE
    if (key in kinds) kinds[key] += row.count
  }

  return {
    ...counts,
    kinds,
    unemailed,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  }
}

export async function getById(id) {
  return findOrThrow(id)
}

/**
 * Records what was done about a lead.
 *
 * Status and note in one call because that is how the work actually happens — somebody
 * rings a company and then marks it contacted, and splitting that into two requests
 * invites the second one to be forgotten, leaving a status change nobody can explain.
 *
 * Notes are appended, never edited or removed. A note that can be rewritten is not a
 * record of what happened, and the reason to keep this history at all is so a lead handed
 * between two people does not lose its thread.
 */
export async function update(id, { status, note }, context) {
  const enquiry = await findOrThrow(id)
  const previousStatus = enquiry.status

  if (note) {
    enquiry.notes.push({
      by: context.actor._id,
      // Denormalised on purpose: an author who is later renamed or deactivated must not
      // turn their notes into unattributed text.
      byName: context.actor.name,
      text: note,
      at: new Date(),
    })
  }

  if (status) enquiry.status = status

  await enquiry.save()

  await audit.record({
    actor: context.actor,
    action: 'enquiry.update',
    entity: 'Enquiry',
    entityId: enquiry._id,
    changes: {
      ...(status && status !== previousStatus
        ? { status: { from: previousStatus, to: status } }
        : {}),
      // The note's presence is recorded, not its text — the note already lives on the
      // enquiry, and copying it here would duplicate free text into the audit trail.
      ...(note ? { noteAdded: true } : {}),
    },
    ip: context.ip,
  })

  return enquiry
}
