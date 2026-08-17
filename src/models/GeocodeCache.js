import mongoose from 'mongoose'

/**
 * Remembered geocoding results.
 *
 * **Geocoding is billed per lookup**, and the same address gets looked up over and over:
 * a customer retrying a checkout, correcting a typo, or ordering again next week. Without
 * a cache each of those is a fresh charge for an answer we already had.
 *
 * Keyed on a normalised form of the query rather than the raw string, so `House 12,
 * Street 4, DHA` and `house 12 street 4 dha` are one cache entry rather than two.
 */
const geocodeCacheSchema = new mongoose.Schema(
  {
    /** Normalised query — see `cacheKey()`. Unique, because this IS the lookup. */
    key: { type: String, required: true, unique: true },

    /** The query exactly as the customer typed it, for debugging a bad match. */
    query: { type: String, required: true },

    /** GeoJSON `[longitude, latitude]`, matching the Branch model's convention. */
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },

    /** What the provider thinks this place is called. Shown back for confirmation. */
    formattedAddress: { type: String, default: '' },

    /** Which provider answered, so a cache built by one is identifiable after a switch. */
    provider: { type: String, required: true },

    /**
     * A query the provider could not place at all.
     *
     * Cached deliberately: a customer who types nonsense usually submits it more than
     * once, and re-asking a paid API to fail again costs money to learn nothing.
     */
    notFound: { type: Boolean, default: false },

    /**
     * Cache entries expire rather than living forever — new buildings get mapped, and
     * roads get renamed. Ninety days is long enough that repeat customers stay free and
     * short enough that the data does not silently rot.
     */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
)

geocodeCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

/**
 * Lowercased, punctuation-stripped, whitespace-collapsed.
 *
 * The point is that trivial differences in how a person types the same address do not
 * each cost a lookup.
 */
export function cacheKey(query) {
  return String(query)
    .toLowerCase()
    .replace(/[.,#\-/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const GeocodeCache = mongoose.model('GeocodeCache', geocodeCacheSchema)
