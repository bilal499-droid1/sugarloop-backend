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
