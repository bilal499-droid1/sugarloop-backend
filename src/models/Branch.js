import mongoose from 'mongoose'
import {
  DEFAULT_DELIVERY_RADIUS_KM,
  DEFAULT_MAX_DELIVERY_MINUTES,
  DEFAULT_MAX_DELIVERY_ROAD_KM,
  DEFAULT_LAST_ORDER_BUFFER_MINUTES,
  FULFILMENT,
} from '../config/constants.js'
import { isOpenAt, minutesUntilLastOrder, nextOpeningAt } from '../utils/time.js'

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    /** Short human key — 'DHA2'. Appears in order numbers, so it never changes. */
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9]{2,10}$/, 'Code must be 2-10 uppercase letters or digits'],
    },

    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true, default: 'Islamabad' },
    phone: { type: String, required: true, trim: true },

    /**
     * GeoJSON, so the delivery-radius check is a $geoNear the database can answer with
     * an index instead of a haversine loop over every branch in Node.
     *
     * Coordinate order is [longitude, latitude]. This is backwards from every map UI
     * and is the single most common way to end up delivering from the Arabian Sea.
     */
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (value) =>
            value.length === 2 &&
            value[0] >= -180 && value[0] <= 180 &&
            value[1] >= -90 && value[1] <= 90,
          message: 'coordinates must be [longitude, latitude] within valid ranges',
        },
      },
    },

    /** Confirmed at 2 km for every branch. Per-branch so it can be widened without a deploy. */
    deliveryRadiusKm: { type: Number, default: DEFAULT_DELIVERY_RADIUS_KM, min: 0 },

    /**
     * The delivery rule when ROUTER=osrm: a ride must be under BOTH.
     *
     * Two limits rather than one because each alone lets the wrong order through. Time
     * alone would accept a 25 km motorway run that happens to be quick, which is a rider
     * gone for the best part of an hour round trip. Distance alone would refuse a
     * neighbouring sector that is three minutes away but sits across a boundary the road
     * has to loop around — the Westridge case, where 3.65 km in a straight line is a
     * 9.97 km ride but still only fifteen minutes.
     *
     * Time is the limit that reflects the product (these are fresh bakery items) and the
     * one customers understand; the distance cap is a backstop on rider cost.
     *
     * Per branch and editable through the staff endpoint, because a shop on a main road
     * covers ground in twenty minutes that a shop inside a housing scheme does not.
     */
    maxDeliveryMinutes: { type: Number, default: DEFAULT_MAX_DELIVERY_MINUTES, min: 0 },
    maxDeliveryRoadKm: { type: Number, default: DEFAULT_MAX_DELIVERY_ROAD_KM, min: 0 },

    /**
     * Wall-clock times in BUSINESS_TIMEZONE, and the window CROSSES MIDNIGHT
     * (11:00 → 03:00). Stored as strings rather than UTC offsets so "we open at 11"
     * stays true across a timezone database update, which a stored offset would not.
     */
    hours: {
      open: { type: String, required: true, default: '11:00', match: [TIME_OF_DAY, 'open must be HH:MM'] },
      close: { type: String, required: true, default: '03:00', match: [TIME_OF_DAY, 'close must be HH:MM'] },
    },

    /** Stop taking orders this long before closing, so the kitchen can finish them. */
    lastOrderBufferMinutes: {
      type: Number,
      default: DEFAULT_LAST_ORDER_BUFFER_MINUTES,
      min: 0,
    },

    fulfilment: {
      type: [String],
      enum: Object.values(FULFILMENT),
      default: () => [FULFILMENT.DELIVERY, FULFILMENT.PICKUP],
      validate: {
        validator: (modes) => modes.length > 0,
        message: 'A branch must offer at least one fulfilment mode',
      },
    },

    /**
     * Two separate switches, because they answer different questions.
     * `isActive` — is this a real, operating branch? (Deactivated, not deleted: past
     *              orders still have to resolve.)
     * `acceptingOrders` — the manager's kill switch mid-rush. Branch is open, kitchen
     *              is drowning, stop the queue for twenty minutes.
     */
    isActive: { type: Boolean, default: true, index: true },
    acceptingOrders: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: stripInternals },
    toObject: { virtuals: true, transform: stripInternals },
  }
)

function stripInternals(_doc, ret) {
  delete ret._id
  delete ret.__v
  return ret
}

branchSchema.index({ location: '2dsphere' })

/**
 * The hours arithmetic itself lives in `utils/time.js` — pure, and unit-tested at every
 * awkward minute of the day without needing a database. What the model adds on top is the
 * two switches only a branch document knows about: `isActive` and `acceptingOrders`.
 */

/** Is the branch trading at `date`, less `bufferMinutes` at the end of the window? */
branchSchema.methods.isOpenAt = function isOpenAtMethod(date = new Date(), bufferMinutes = 0) {
  if (!this.isActive) return false

  return isOpenAt({
    open: this.hours.open,
    close: this.hours.close,
    at: date,
    bufferMinutes,
  })
}

/**
 * How long before closing a fulfilment mode stops taking orders.
 *
 * Only delivery stops early: a rider has to get there and back before the shop shuts. A
 * customer collecting walks in, so pickup runs right up to closing time (client's
 * instruction, 2026-09-17).
 */
branchSchema.methods.lastOrderBufferFor = function lastOrderBufferFor(fulfilment) {
  return fulfilment === FULFILMENT.PICKUP ? 0 : this.lastOrderBufferMinutes
}

/**
 * The buffer for `fulfilment`, or — when none is named — the shortest across the modes
 * this branch offers, i.e. "can this branch take ANY order right now". That is what the
 * branch picker's "Open now" means: a shop that has stopped delivering at 23:30 is still
 * taking collection orders until midnight.
 */
function bufferFor(branch, fulfilment) {
  if (fulfilment) return branch.lastOrderBufferFor(fulfilment)
  return Math.min(...branch.fulfilment.map((mode) => branch.lastOrderBufferFor(mode)))
}

/**
 * Open, far enough from closing for this fulfilment mode (delivery stops
 * `lastOrderBufferMinutes` early, pickup does not), and not paused by the manager
 * mid-rush. The pricing engine calls it with the order's fulfilment.
 */
branchSchema.methods.isAcceptingOrdersAt = function isAcceptingOrdersAtMethod(
  date = new Date(),
  fulfilment = undefined
) {
  if (!this.acceptingOrders) return false
  return this.isOpenAt(date, bufferFor(this, fulfilment))
}

/** The next instant this branch opens — what a "Closed, opens at 11am" rejection quotes. */
branchSchema.methods.nextOpeningAt = function nextOpeningAtMethod(date = new Date()) {
  return nextOpeningAt({ open: this.hours.open, at: date })
}

/** Minutes until the last-order cutoff, or null if orders are not being taken. */
branchSchema.methods.minutesUntilLastOrder = function minutesUntilLastOrderMethod(
  date = new Date(),
  fulfilment = undefined
) {
  if (!this.isActive || !this.acceptingOrders) return null

  return minutesUntilLastOrder({
    open: this.hours.open,
    close: this.hours.close,
    at: date,
    bufferMinutes: bufferFor(this, fulfilment),
  })
}

export const Branch = mongoose.model('Branch', branchSchema)
