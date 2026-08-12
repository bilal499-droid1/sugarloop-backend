import mongoose from 'mongoose'
import { PRODUCT_CATEGORIES } from '../config/constants.js'
import { formatPKR } from '../utils/money.js'

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    /** Cloudinary's handle for the asset — required to delete or transform it later. */
    publicId: { type: String, required: true, trim: true },
    alt: { type: String, trim: true, default: '' },
    order: { type: Number, default: 0 },
  },
  { _id: false }
)

/**
 * A catalogue item. One global price list — a branch manager can never change a price,
 * only whether the item is in stock at their branch (see BranchStock).
 *
 * The price lives here and ONLY here. Checkout re-reads it from this collection at order
 * time and ignores whatever the client sent; today the frontend trusts localStorage,
 * where anyone can edit a price to 1 in devtools.
 */
const productSchema = new mongoose.Schema(
  {
    /**
     * Stable, human-readable, printed on kitchen tickets — 'DON-CHOCOHOLIC'.
     * Exists now so that when Nimbus POS arrives in Phase 2 there is something to map
     * against; retrofitting a key onto orders that already reference products is worse.
     */
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'SKU must be uppercase segments separated by hyphens'],
    },

    /**
     * The numeric id this product had in the frontend's `productsData.js`.
     *
     * Kept because the live site ships carts in localStorage under `sugarloop.cart.v1`,
     * keyed by these ids. On cutover the catalogue starts coming from this collection,
     * and without a mapping every cart a customer left open silently breaks.
     *
     * Sparse and without a default: the 43 seeded products carry one, anything an admin
     * creates later has no legacy id and must not collide on `null` in the unique index.
     * Nothing in the API identifies a product this way — that is `slug`. Once the
     * frontend has cut over and old carts have expired, this field can be dropped.
     */
    legacyId: { type: Number, unique: true, sparse: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },

    /** The stable public identifier used in URLs. */
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens'],
    },

    category: { type: String, required: true, enum: PRODUCT_CATEGORIES },

    /** Menu sub-heading within a category — 'Signature', 'Crafted'. Free text by design. */
    type: { type: String, trim: true, default: '' },

    // PKR, stored as whole hundredths of a rupee. See utils/money.js for why not a float.
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Price must be a whole stored amount — Rs 299 is 29900',
      },
    },

    description: { type: String, trim: true, maxlength: 2000, default: '' },

    images: { type: [imageSchema], default: [] },

    /** Free text on the item card. Whether this is required at launch is still open (§16). */
    allergens: { type: [String], default: [] },

    /** Can go in a Build-Your-Box slot. Box of N holds exactly N, price = sum of contents. */
    boxEligible: { type: Boolean, default: false },

    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 100 },

    /**
     * Discontinued — hidden from the site entirely. Distinct from being out of stock,
     * which is per branch and lives on BranchStock. Deleting is not an option: past
     * orders reference this document and an order whose lines cannot resolve a product
     * is an order nobody can reprint or dispute.
     */
    isActive: { type: Boolean, default: true, index: true },

    // --- FBR fields, dormant until integration (plan §9b) ---------------------
    // Nothing is charged or filed in Phase 1. These exist now because FBR reports per
    // line item, and retrofitting a tax breakdown onto historical orders is the
    // expensive migration the whole design is arranged to avoid.

    /** FBR's product classification code. Filled in at integration. */
    pctCode: { type: String, default: null },

    taxRatePercent: { type: Number, default: 0, min: 0 },

    /**
     * Whether the displayed price already contains tax. A business decision, not a
     * technical one: inclusive keeps Rs 299 at Rs 299 and cuts the margin; exclusive
     * makes it ~Rs 353 at checkout and disagrees with every printed price.
     */
    priceIncludesTax: { type: Boolean, default: true },
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

/** Display only — the frontend should never do arithmetic on this. */
productSchema.virtual('priceFormatted').get(function priceFormatted() {
  return formatPKR(this.price)
})

// The menu is fetched as "active items in this category, in merchandised order" on
// nearly every page load. This index serves that query without a sort stage.
productSchema.index({ category: 1, sortOrder: 1, name: 1 })

// Build Your Box only ever asks for eligible, active items.
productSchema.index({ boxEligible: 1, isActive: 1 })

export const Product = mongoose.model('Product', productSchema)
