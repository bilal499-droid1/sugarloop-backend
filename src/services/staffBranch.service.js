/**
 * Opening a branch.
 *
 * Branches were seed-only until now, which was right while there were four of them and
 * wrong the moment a fifth shop opens: adding one meant editing `seed.js` and a deploy,
 * and until it existed there was no branch to assign a new manager to. That is the actual
 * blocker this removes — `POST /staff/users` demands a `branchId`, so "hire a manager for
 * the new shop" is unanswerable until the shop is a row.
 *
 * Deliberately create-only. Editing a branch means moving a shop that has live orders
 * pointing at it, and deleting one is never right — `isActive: false` is how a branch
 * stops trading, because every past order still has to resolve the branch it came from.
 * Both are their own piece of work with their own rules; neither is needed to open a shop.
 *
 * No `BranchStock` rows are written. The catalogue treats a product with no row as IN
 * stock (see `catalogue.service.js`), so a new branch sells the full menu on day one and
 * the manager marks things out as they run out — which is the same state a branch reaches
 * anyway, without 43 rows nobody asked for.
 */
import { Branch } from '../models/Branch.js'
import { ApiError } from '../utils/ApiError.js'
import { assertBranchAccess } from '../middleware/auth.js'
import { STAFF_ROLE } from '../config/constants.js'
import * as audit from './audit.service.js'

export async function create(input, context) {
  const { location, ...rest } = input

  const branch = await Branch.create({
    ...rest,
    // [longitude, latitude] — the model's order, not the map UI's. See the validator.
    location: { type: 'Point', coordinates: [location.lng, location.lat] },
  })

  await audit.record({
    actor: context.actor,
    action: 'branch.create',
    entity: 'Branch',
    entityId: branch._id,
    changes: {
      code: branch.code,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      // Written back in the human order rather than the stored one, so a person reading
      // this trail can paste it into a map without reversing it first.
      location: { lat: location.lat, lng: location.lng },
      hours: { open: branch.hours.open, close: branch.hours.close },
      deliveryRadiusKm: branch.deliveryRadiusKm,
    },
    ip: context.ip,
  })

  return branch
}

const AUDITED_FIELDS = ['isActive', 'acceptingOrders']

/**
 * Flips one or both of a branch's two switches.
 *
 * They answer different questions and carry different authority, which is why one
 * endpoint guards them separately rather than exposing a general branch editor:
 *
 *   `acceptingOrders`  the kill switch mid-rush. The branch is open and staffed, the
 *                      kitchen is drowning, stop the queue for twenty minutes. The
 *                      manager standing in it is exactly who should press this, so a
 *                      branch manager may — on their OWN branch, never another's.
 *
 *   `isActive`         the shop is not a shop any more. It vanishes from the storefront,
 *                      from every picker and from new orders. Admin only: closing a
 *                      branch is not a shift decision, and a manager who could would be
 *                      one misclick from taking their own shop off the map.
 *
 * Neither deletes anything. Every order stores the branch it came from, so a removed
 * document is order history nobody can reprint or dispute — `isActive: false` is what
 * "delete this branch" actually means, and unlike a delete it is reversible.
 */
export async function update(id, payload, context) {
  const branch = await Branch.findById(id)
  if (!branch) throw ApiError.notFound('Branch not found')

  const isAdmin = context.actor.role === STAFF_ROLE.ADMIN

  if (!isAdmin) {
    // Their own branch, and only the switch their role owns. Both are 403s rather than
    // 422s: the request is well-formed, the caller simply is not allowed to make it.
    assertBranchAccess(context.actor, branch._id)

    if (payload.isActive !== undefined) {
      throw ApiError.forbidden('Only an admin can open or close a branch')
    }
  }

  const before = AUDITED_FIELDS.reduce((acc, field) => {
    acc[field] = branch[field]
    return acc
  }, {})

  Object.assign(branch, payload)
  await branch.save()

  const changes = audit.diff(before, branch, AUDITED_FIELDS)

  // A toggle set to what it already was is not worth a row — it would only make the rows
  // that do matter harder to find.
  if (changes) {
    await audit.record({
      actor: context.actor,
      action: 'branch.update',
      entity: 'Branch',
      entityId: branch._id,
      // The code is what a human scanning this trail has in hand; entityId is what a
      // query joins on. Both, because they answer different questions.
      changes: { code: branch.code, ...changes },
      ip: context.ip,
    })
  }

  return branch
}

/**
 * Every branch, including the closed ones.
 *
 * The public `GET /branches` filters to `isActive: true`, which is right for a storefront
 * and useless here: an admin looking for the shop that vanished from the site is looking
 * for exactly the one it hides, and a console that could close a branch but never list it
 * again could never reopen one.
 */
export async function list() {
  return Branch.find().sort({ isActive: -1, code: 1 })
}
