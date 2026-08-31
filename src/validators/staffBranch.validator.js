import { z } from 'zod'
import { FULFILMENT } from '../config/constants.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

export const idParamSchema = z.object({ id: objectId })

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

/**
 * The two switches, and only the two switches.
 *
 * Deliberately not a general branch editor. Name, address and pin are what deliveries are
 * quoted from and what every past order was placed against; moving them is a different
 * operation with different consequences, and bundling it into the control a manager hits
 * mid-rush is how a shop ends up somewhere else by accident. `code` can never change at
 * all — it is baked into every order number that branch has issued.
 *
 * Which of the two a caller may set is a role question, so it lives in the service rather
 * than here: an admin may set both, a branch manager only `acceptingOrders`, and only on
 * their own branch.
 */
export const updateBranchSchema = z
  .object({
    /** Is this a real, operating branch? Admin only — this is closing a shop. */
    isActive: z.boolean(),

    /** The kill switch mid-rush: open, but stop the queue. Managers use this one. */
    acceptingOrders: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to change — send isActive or acceptingOrders',
  })
