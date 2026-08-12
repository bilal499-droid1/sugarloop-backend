import mongoose from 'mongoose'
import {
  FAILURE_REASON,
  FISCAL_STATUS,
  FULFILMENT,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from '../config/constants.js'

/**
 * A line on an order.
 *
 * Every descriptive field is SNAPSHOTTED at order time — name, sku and unitPrice are
 * copied here rather than looked up through `productId` when the order is read. A price
 * rise next month must not silently rewrite what a customer was charged last month, and a
 * renamed or discontinued product must still print on its own receipt.
 *
 * `productId` is kept alongside so reorder and reporting can still resolve the catalogue
 * item; it is a reference, not the source of truth for what this line cost.
 */
const orderItemSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['product', 'box'], required: true },

    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    sku: { type: String, trim: true },
    name: { type: String, required: true, trim: true },

    unitPrice: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },

    /** Build Your Box: the size, and what was actually in it. */
    boxSize: { type: Number, default: null },
    children: {
      type: [
        new mongoose.Schema(
          {
            productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
            sku: String,
            name: String,
            unitPrice: Number,
          },
          { _id: false }
        ),
      ],
      default: undefined,
    },

    // --- FBR breakdown, per line (design §9b) --------------------------------
    // Stored at 0% today. FBR reports per line item, and a historical order that only
    // ever kept a grand total cannot be reported at all — which is the migration this
    // whole shape exists to avoid.
    netAmount: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, required: true, default: 0, min: 0 },
    taxAmount: { type: Number, required: true, default: 0, min: 0 },
    grossAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, enum: Object.values(ORDER_STATUS), required: true },
    at: { type: Date, required: true, default: Date.now },

    /**
     * Who caused it: a StaffUser id, or the string 'system' for a timed transition.
     * Mixed on purpose — the alternative is a nullable id plus a boolean, which is the
     * same information with an extra way to be inconsistent.
     */
    by: { type: mongoose.Schema.Types.Mixed, required: true, default: 'system' },

    note: { type: String, trim: true, maxlength: 500 },

    /** Required when moving to `failed`. Enforced in the service. */
    reason: { type: String, enum: [...Object.values(FAILURE_REASON), null], default: null },
  },
  { _id: false }
)

const orderSchema = new mongoose.Schema(
  {
    /**
     * `SL-260810-0042` — date-scoped and sequential. Readable over the phone, which is
     * what matters when a customer rings the branch about it. Doubles as the invoice
     * number, so it is never reissued or reused.
     */
    orderNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },

    /**
     * Null until phone-OTP lands in Sprint 2. Contact details below are what a COD order
     * actually needs today; `customerId` is the hook that turns them into an account and
     * an order history once identity exists.
     */
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },

    contact: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      /** E.164. The only handle on a COD customer, and the one staff will ring. */
      phone: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true, default: null },
    },

    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    branchCode: { type: String, required: true, uppercase: true, trim: true },

    fulfilment: { type: String, enum: Object.values(FULFILMENT), required: true },

    /** Null for pickup — there is no address to deliver to. */
    address: {
      type: new mongoose.Schema(
        {
          line1: { type: String, required: true, trim: true, maxlength: 300 },
          area: { type: String, trim: true, maxlength: 120 },
          city: { type: String, trim: true, default: 'Islamabad' },
          location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], required: true },
          },
          notes: { type: String, trim: true, maxlength: 500 },
        },
        { _id: false }
      ),
      default: null,
    },

    /** Straight-line distance from the branch at order time. Null for pickup. */
    distanceKm: { type: Number, default: null },

    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (items) => items.length > 0,
        message: 'An order must contain at least one item',
      },
    },

    totals: {
      subtotal: { type: Number, required: true, min: 0 },
      deliveryFee: { type: Number, required: true, default: 0, min: 0 },
      discount: { type: Number, required: true, default: 0, min: 0 },
      tax: { type: Number, required: true, default: 0, min: 0 },
      grandTotal: { type: Number, required: true, min: 0 },
    },

    payment: {
      method: { type: String, enum: Object.values(PAYMENT_METHOD), default: PAYMENT_METHOD.COD },
      status: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING },
      provider: { type: String, default: null },
    },

    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      required: true,
      default: ORDER_STATUS.PLACED,
    },

    /** Append-only. Every transition, who caused it, and why. */
    statusHistory: { type: [statusEventSchema], default: [] },

    /** Set once, when the order moves to `failed`. Terminal and reportable. */
    failureReason: { type: String, enum: [...Object.values(FAILURE_REASON), null], default: null },

    /** Quoted lead time shown to the customer: placedAt + 45 minutes. */
    promisedAt: { type: Date, required: true },

    // --- FBR, dormant (design §9b) -------------------------------------------
    // Every order is `not_applicable` in Phase 1. Flipping a branch's fbrEnabled flag
    // starts new orders at `pending` instead — a config change, not a migration.
    fiscal: {
      status: {
        type: String,
        enum: Object.values(FISCAL_STATUS),
        default: FISCAL_STATUS.NOT_APPLICABLE,
      },
      posId: { type: String, default: null },
      invoiceNumber: { type: String, default: null },
      qrPayload: { type: String, default: null },
      submittedAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
      lastError: { type: String, default: null },
    },

    /**
     * Never leaves the API. `views/orderView.js` is what keeps it internal — this is the
     * fraud trail for a payment method where nobody has paid anything yet.
     */
    meta: {
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' },
      source: { type: String, default: 'web' },
    },
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

// The order board's default query: this branch, this status, newest first.
orderSchema.index({ branchId: 1, status: 1, createdAt: -1 })

// "Today's orders", for the daily report and the dashboard date filter.
orderSchema.index({ createdAt: -1 })

// A customer ringing about their order quotes the number, and the phone is what proves
// it is theirs while there is no customer login.
orderSchema.index({ 'contact.phone': 1, createdAt: -1 })

export const Order = mongoose.model('Order', orderSchema)
