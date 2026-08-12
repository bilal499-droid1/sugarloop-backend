import { logger } from '../config/logger.js'
import { AuditLog } from '../models/AuditLog.js'

/**
 * Write an audit entry.
 *
 * Deliberately never throws. An audit write failing must not turn a successful staff
 * action into a 500 — the action already happened, and reporting it as failed would
 * make the operator repeat it. The failure is logged loudly instead, which is the
 * signal an operator can act on.
 */
export async function record({ actor, action, entity, entityId, changes = null, ip = '' }) {
  try {
    await AuditLog.create({
      actorId: actor?._id ?? null,
      actorEmail: actor?.email ?? '',
      actorRole: actor?.role ?? '',
      action,
      entity,
      entityId: entityId ?? null,
      changes,
      ip,
    })
  } catch (err) {
    logger.error({ err, action, entity, entityId }, 'Failed to write audit log entry')
  }
}

/**
 * Before/after for only the fields that actually moved.
 *
 * Recording an unchanged field as a "change" makes the trail unreadable at exactly the
 * moment someone is scanning it for the one thing that did move.
 */
export function diff(before, after, fields) {
  const changes = {}
  for (const field of fields) {
    const from = normalise(before?.[field])
    const to = normalise(after?.[field])
    if (from !== to) changes[field] = { from, to }
  }
  return Object.keys(changes).length > 0 ? changes : null
}

/** ObjectIds and Dates compare by identity, not value, so flatten them to strings. */
function normalise(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return String(value)
  return value
}
