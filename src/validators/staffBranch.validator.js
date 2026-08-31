import { z } from 'zod'
import { FULFILMENT } from '../config/constants.js'

/** Matches the Branch model's rule, so a bad code is a 422 rather than a Mongoose throw. */
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Code must be 2-10 uppercase letters or digits')

const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be a 24-hour time like 11:00')

/**
 * Opening a new shop.
 *
 * `location` is taken as named `{ lat, lng }` and flipped to GeoJSON in the service, for
 * the reason the Branch model spells out: the stored array is `[longitude, latitude]`,
 * which is backwards from every map UI and is the single most common way to end up
 * delivering from the Arabian Sea. Named keys make it impossible to get wrong on the way
 * in, the same way `branchView` makes it impossible on the way out.
 *
 * Everything with a sensible house default has one — hours, radius, cutoff, fulfilment —
 * because an admin opening a fifth shop on the client's existing terms should not have to
 * restate them. `code` has none: it is baked into every order number that branch will ever
 * issue, so it is worth being asked for deliberately.
 */
export const createBranchSchema = z.object({
  code,
  name: z.string().trim().min(1, 'A branch needs a name').max(120),
  address: z.string().trim().min(6, 'Please enter a fuller address').max(300),
  city: z.string().trim().min(1).max(120).optional().default('Islamabad'),
  phone: z.string().trim().min(6, 'A branch needs a phone number').max(40),

  location: z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  }),

  deliveryRadiusKm: z.coerce.number().min(0).max(50).optional(),
  hours: z.object({ open: timeOfDay, close: timeOfDay }).optional(),
  lastOrderBufferMinutes: z.coerce.number().int().min(0).max(240).optional(),
  fulfilment: z
    .array(z.enum(Object.values(FULFILMENT)))
    .min(1, 'A branch must offer at least one fulfilment mode')
    .optional(),
})
