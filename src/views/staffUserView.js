/**
 * Response shape for a staff user.
 *
 * The `views/` layer exists so that exactly one file decides what leaves the API for a
 * given audience. The model's `toJSON` already strips the password hash and the lockout
 * counters, but that is a safety net, not a policy — a raw document also carries
 * `createdAt`, `updatedAt` and whatever gets added to the schema next month, and none of
 * that should reach a client because somebody forgot to think about it.
 */

function branchOf(staffUser) {
  const branch = staffUser.branchId
  if (!branch) return null
  // Populated or not — the caller shouldn't have to know which.
  if (typeof branch === 'object' && branch.code) {
    return { id: String(branch._id ?? branch.id), code: branch.code, name: branch.name }
  }
  return { id: String(branch) }
}

/** What a staff member sees about themselves, and what an admin sees in a list. */
export function staffUserView(staffUser) {
  return {
    id: String(staffUser._id),
    name: staffUser.name,
    email: staffUser.email,
    role: staffUser.role,
    branch: branchOf(staffUser),
    isActive: staffUser.isActive,
    lastLoginAt: staffUser.lastLoginAt,
    createdAt: staffUser.createdAt,
  }
}

export function staffUserListView(staffUsers) {
  return staffUsers.map(staffUserView)
}
