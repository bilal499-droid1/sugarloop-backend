import { ApiError } from '../utils/ApiError.js'
import { STAFF_ROLE } from '../config/constants.js'
import { StaffUser } from '../models/StaffUser.js'
import { verifyAccessToken } from '../services/staffAuth.service.js'
import { asyncHandler } from '../utils/asyncHandler.js'

function bearerToken(req) {
  const header = req.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (!/^Bearer$/i.test(scheme) || !token) return null
  return token.trim()
}

/**
 * Authenticates a staff access token and attaches the live StaffUser document.
 *
 * The database read on every request is deliberate. The alternative — trusting the
 * role and branch baked into the token — means a dismissed employee keeps full access
 * until their access token expires. Fifteen minutes is a long time to hold a grudge
 * and an order board. One indexed lookup by _id is a fair price for revocation that
 * takes effect immediately.
 */
export const requireStaff = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req)
  if (!token) throw ApiError.unauthorized('Authentication required')

  const payload = verifyAccessToken(token)

  // Branch populated so /me and every downstream view name the branch rather than
  // handing the client a bare id to look up. Safe against the comparison trap above.
  const staffUser = await StaffUser.findById(payload.sub).populate('branchId', 'code name')
  if (!staffUser) throw ApiError.unauthorized('Invalid access token')
  if (!staffUser.isActive) throw ApiError.forbidden('This account has been deactivated')

  req.staff = staffUser
  next()
})

/**
 * Role gate. Mount after requireStaff.
 *
 *   router.post('/products', requireStaff, requireRole(STAFF_ROLE.ADMIN), handler)
 */
export function requireRole(...roles) {
  const allowed = new Set(roles)
  return (req, _res, next) => {
    if (!req.staff) {
      // A programming error, not a client error: the route is misconfigured. Surfacing
      // it as 500 is right — quietly returning 401 would hide the missing guard.
      return next(ApiError.internal('requireRole used without requireStaff'))
    }
    if (!allowed.has(req.staff.role)) {
      return next(ApiError.forbidden('Your role does not permit this action'))
    }
    next()
  }
}

/**
 * An id as a string, whether it arrives as an ObjectId, a string, or a populated document.
 *
 * `String(doc)` on a populated Mongoose document does NOT give its _id — it gives the
 * inspected object. Comparing that against a real id silently fails, which would lock
 * every branch manager out of their own branch the first time somebody adds a
 * `.populate('branchId')` upstream. That is exactly what happened here, so the
 * comparison is made immune to it rather than left as a rule to remember.
 */
function idOf(value) {
  if (!value) return null
  return String(value._id ?? value)
}

/**
 * Admins see every branch; a branch manager sees exactly their own.
 *
 * Exported as a predicate rather than middleware because most uses are inside a
 * controller that has already loaded the resource — the branch being checked usually
 * comes off an order, not off the URL.
 */
export function canAccessBranch(staffUser, branchId) {
  if (staffUser.role === STAFF_ROLE.ADMIN) return true

  const own = idOf(staffUser.branchId)
  const target = idOf(branchId)

  if (!own || !target) return false
  return own === target
}

/** The same rule, as a thrown 403, for the common `if (!allowed) return` case. */
export function assertBranchAccess(staffUser, branchId) {
  if (!canAccessBranch(staffUser, branchId)) {
    throw ApiError.forbidden('You do not have access to this branch')
  }
}
