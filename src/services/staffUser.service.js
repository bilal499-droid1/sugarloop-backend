import { ApiError } from '../utils/ApiError.js'
import { STAFF_ROLE } from '../config/constants.js'
import { StaffUser } from '../models/StaffUser.js'
import { Branch } from '../models/Branch.js'
import { revokeAllSessions } from './staffAuth.service.js'
import * as audit from './audit.service.js'

/** User input reaches a regex here, so metacharacters have to stop being metacharacters. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function assertBranchExists(branchId) {
  if (!branchId) return
  const exists = await Branch.exists({ _id: branchId })
  if (!exists) {
    throw ApiError.validation('Branch does not exist', [
      { field: 'branchId', message: 'Unknown branch' },
    ])
  }
}

/**
 * Resolves the role/branch pair, because changing one without the other is the common
 * case and failing on it would be pedantic.
 *
 * Promoting to admin clears the branch; demoting to branch manager requires one, either
 * in this request or already on the record.
 */
function resolveRoleAndBranch({ role, branchId }, current) {
  const nextRole = role ?? current?.role
  const branchProvided = branchId !== undefined
  const nextBranch = branchProvided ? branchId : (current?.branchId ?? null)

  if (nextRole === STAFF_ROLE.ADMIN) {
    if (branchProvided && branchId) {
      throw ApiError.validation('An admin cannot be assigned to a branch', [
        { field: 'branchId', message: 'Must be null for an admin' },
      ])
    }
    return { role: nextRole, branchId: null }
  }

  if (!nextBranch) {
    throw ApiError.validation('A branch manager must be assigned to a branch', [
      { field: 'branchId', message: 'Required for a branch manager' },
    ])
  }

  return { role: nextRole, branchId: nextBranch }
}

/**
 * The system must never be left without a way in.
 *
 * Counts OTHER active admins rather than all of them, so the check is about what
 * survives the change, not what exists now.
 */
async function assertNotLastAdmin(target) {
  if (target.role !== STAFF_ROLE.ADMIN || !target.isActive) return

  const remaining = await StaffUser.countDocuments({
    _id: { $ne: target._id },
    role: STAFF_ROLE.ADMIN,
    isActive: true,
  })

  if (remaining === 0) {
    throw ApiError.conflict(
      'This is the last active admin. Promote another admin before changing this account.'
    )
  }
}

/**
 * An admin cannot demote, disable or delete themselves.
 *
 * Not because it is dangerous in itself — the last-admin check already covers lockout —
 * but because the confirmation dialog for "remove admin access" is always about someone
 * else, and the one time it isn't, it is a misclick.
 */
function assertNotSelf(actor, targetId, action) {
  if (String(actor._id) === String(targetId)) {
    throw ApiError.forbidden(`You cannot ${action} your own account`)
  }
}

async function findOrThrow(id, { withPassword = false } = {}) {
  const query = StaffUser.findById(id)
  if (withPassword) query.select('+passwordHash')
  const staffUser = await query
  if (!staffUser) throw ApiError.notFound('Staff member not found')
  return staffUser
}

export async function list({ role, branchId, isActive, search, limit, cursor }) {
  const filter = {}
  if (role) filter.role = role
  if (branchId) filter.branchId = branchId
  if (isActive !== undefined) filter.isActive = isActive
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i')
    filter.$or = [{ name: pattern }, { email: pattern }]
  }
  // Cursor pagination on _id. Ordering by name would read better, but a name cursor
  // needs a unique tiebreaker to avoid skipping rows, and _id already is one.
  if (cursor) filter._id = { $lt: cursor }

  // One extra row tells us whether another page exists without a second count query.
  const rows = await StaffUser.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('branchId', 'code name')

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
  }
}

export async function getById(id) {
  return StaffUser.findById(id)
    .populate('branchId', 'code name')
    .then((staffUser) => {
      if (!staffUser) throw ApiError.notFound('Staff member not found')
      return staffUser
    })
}

export async function create({ name, email, password, role, branchId }, context) {
  const resolved = resolveRoleAndBranch({ role, branchId }, null)
  await assertBranchExists(resolved.branchId)

  // Assigned to passwordHash because the model's pre-save hook hashes that path.
  // A duplicate email surfaces as a 409 from the error handler's 11000 branch.
  const staffUser = await StaffUser.create({
    name,
    email,
    passwordHash: password,
    ...resolved,
  })

  await audit.record({
    actor: context.actor,
    action: 'staffUser.create',
    entity: 'StaffUser',
    entityId: staffUser._id,
    changes: { email: staffUser.email, role: staffUser.role },
    ip: context.ip,
  })

  return staffUser
}

export async function update(id, payload, context) {
  const staffUser = await findOrThrow(id)

  const before = staffUser.toObject()
  const changesRole = payload.role !== undefined && payload.role !== staffUser.role
  const isDeactivating = payload.isActive === false && staffUser.isActive

  if (changesRole) assertNotSelf(context.actor, staffUser._id, 'change the role of')
  if (isDeactivating) assertNotSelf(context.actor, staffUser._id, 'deactivate')
  if (changesRole || isDeactivating) await assertNotLastAdmin(staffUser)

  const resolved = resolveRoleAndBranch(payload, staffUser)
  await assertBranchExists(resolved.branchId)

  if (payload.name !== undefined) staffUser.name = payload.name
  if (payload.email !== undefined) staffUser.email = payload.email
  if (payload.isActive !== undefined) staffUser.isActive = payload.isActive
  staffUser.role = resolved.role
  staffUser.branchId = resolved.branchId

  await staffUser.save()

  // Role, branch and active status all feed authorisation. requireStaff re-reads the
  // account on every request so access tokens already reflect this, but refresh tokens
  // are long-lived and there is no reason to leave them standing.
  if (changesRole || isDeactivating || payload.branchId !== undefined) {
    await revokeAllSessions(staffUser._id)
  }

  await audit.record({
    actor: context.actor,
    action: 'staffUser.update',
    entity: 'StaffUser',
    entityId: staffUser._id,
    changes: audit.diff(before, staffUser.toObject(), ['name', 'email', 'role', 'branchId', 'isActive']),
    ip: context.ip,
  })

  return staffUser
}

/**
 * Admin password reset. Deliberately does NOT require the old password — the whole
 * point is that the account owner has lost it.
 */
export async function resetPassword(id, password, context) {
  const staffUser = await findOrThrow(id, { withPassword: true })

  staffUser.passwordHash = password
  // A reset is the standard response to a suspected compromise, so it also clears the
  // lockout and ends every existing session.
  staffUser.failedLoginAttempts = 0
  staffUser.lockedUntil = null
  await staffUser.save()

  await revokeAllSessions(staffUser._id)

  // The new password is never written to the audit trail, only the fact of the reset.
  await audit.record({
    actor: context.actor,
    action: 'staffUser.resetPassword',
    entity: 'StaffUser',
    entityId: staffUser._id,
    ip: context.ip,
  })

  return staffUser
}

/**
 * Soft delete. Orders reference the staff member who confirmed or cancelled them, and
 * an audit trail pointing at a missing document is not an audit trail.
 */
export async function deactivate(id, context) {
  const staffUser = await findOrThrow(id)

  assertNotSelf(context.actor, staffUser._id, 'deactivate')
  await assertNotLastAdmin(staffUser)

  staffUser.isActive = false
  await staffUser.save()
  await revokeAllSessions(staffUser._id)

  await audit.record({
    actor: context.actor,
    action: 'staffUser.deactivate',
    entity: 'StaffUser',
    entityId: staffUser._id,
    changes: { isActive: { from: true, to: false } },
    ip: context.ip,
  })

  return staffUser
}
