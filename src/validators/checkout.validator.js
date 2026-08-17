import { z } from 'zod'
import { BOX_SIZES, FULFILMENT } from '../config/constants.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')

/**
 * A cart line. Note what is absent: `price`, `total`, `name`, `image`.
 *
 * Zod strips unknown keys by default, so a client that posts `price: 1` has it discarded
 * here — before any code could read it even by accident. That is the first of two guards;
 * the second is that the pricing engine only ever reads ids and quantities.
 */
const productItem = z.object({
  kind: z.literal('product').default('product'),
  productId: objectId,
  // 50 of one donut is a real order; 5,000 is a mistake or an attack.
  qty: z.coerce.number().int().min(1).max(50),
})

const boxItem = z.object({
  kind: z.literal('box'),
  boxSize: z.coerce.number().int().refine((size) => BOX_SIZES.includes(size), {
    message: `Box size must be one of ${BOX_SIZES.join(', ')}`,
  }),
  /**
   * Exactly `boxSize` ids, duplicates allowed — two Lotus in a box of four is a real
   * order. The length is checked against boxSize in the engine, where the mismatch can be
   * reported with both numbers.
   */
  productIds: z.array(objectId).min(1).max(Math.max(...BOX_SIZES)),
})

const cartItem = z.discriminatedUnion('kind', [
  productItem.extend({ kind: z.literal('product') }),
  boxItem,
])

const coordinates = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

export const quoteSchema = z
  .object({
    fulfilment: z.enum(Object.values(FULFILMENT)),

    /**
     * Delivery target, as coordinates.
     *
     * Islamabad is around 33.6 N, 73.0 E — a swapped lat/lng lands in the Indian Ocean and
     * is caught by the range checks above rather than by a confused rider.
     */
    location: coordinates.optional(),

    /**
     * Delivery target, as text — geocoded server-side (Step 9).
     *
     * Either this or `location` satisfies a delivery request. `location` wins when both
     * are given: a pin states where someone is more precisely than a line of text, and
     * geocoding an address they also pinned would spend a paid lookup for a worse answer.
     * The minimum length stops "abc" costing a lookup in order to fail.
     */
    addressText: z.string().trim().min(6, 'Please enter a fuller address').max(300).optional(),

    // Pickup: the customer names the branch, by id or by code.
    branchId: objectId.optional(),
    branchCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/).optional(),

    items: z
      .array(cartItem)
      .min(1, 'A cart must contain at least one item')
      // Not a business rule — a bound so one request cannot ask the server to price
      // ten thousand lines.
      .max(100),
  })
  .superRefine((value, ctx) => {
    if (value.fulfilment === FULFILMENT.DELIVERY && !value.location && !value.addressText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['location'],
        message: 'Delivery requires either location { lat, lng } or addressText',
      })
    }

    if (value.fulfilment === FULFILMENT.PICKUP && !value.branchId && !value.branchCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchCode'],
        message: 'Pickup requires branchId or branchCode — the customer chooses the branch',
      })
    }
  })
