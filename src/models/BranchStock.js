import mongoose from 'mongoose'

/**
 * Availability of one product at one branch.
 *
 * Price is global; stock is not. This collection is what lets a manager mark Chocoholic
 * sold out at DHA Phase 5 without touching Phase 2 — a boolean on the Product could only
 * ever hide it everywhere at once, which is the wrong blast radius for a sold-out tray.
 *
 * One row per branch x product. At 4 branches and ~42 products that is under 200 rows,
 * so the whole table is cheap to read and cache per branch.
 */
const branchStockSchema = new mongoose.Schema(
  {
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },

    /**
     * A toggle, not a count. Real inventory counts are Phase 2 — a bakery that fries
     * to demand cannot keep a number accurate, and a wrong number is worse than a
     * boolean a human flips when the tray is empty.
     */
    inStock: { type: Boolean, default: true },

    /** Who flipped it. Pairs with AuditLog for the full trail. */
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffUser', default: null },
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

// Unique so a product cannot end up with two conflicting stock rows at one branch —
// which would make "is this in stock" depend on which document the query happened to
// return first. Also the index the catalogue's per-branch lookup rides on.
branchStockSchema.index({ branchId: 1, productId: 1 }, { unique: true })

// "What is currently out of stock at my branch" — the dashboard's default view.
branchStockSchema.index({ branchId: 1, inStock: 1 })

export const BranchStock = mongoose.model('BranchStock', branchStockSchema)
