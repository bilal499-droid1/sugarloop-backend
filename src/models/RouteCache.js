import mongoose from 'mongoose'

/**
 * Remembered road distances and ride times.
 *
 * The same reasoning as GeocodeCache, for a different lookup. A customer nudging their
 * pin, retrying a failed checkout, or ordering again next week asks the router the same
 * question each time, and the answer does not change between those asks — roads are not
 * rebuilt while someone is choosing a doughnut.
 *
 * It matters less for money here than it does for the geocoder (a self-hosted OSRM is
 * free per request) and more for latency: routing sits in the checkout path, so every
 * cache hit is a round trip a customer does not wait for.
 */
const routeCacheSchema = new mongoose.Schema(
  {
    /** `<lat>,<lng>:<branchId>`, rounded — see `routeCacheKey()`. Unique; this IS the lookup. */
    key: { type: String, required: true, unique: true },

    /** Road distance in metres, as the router reported it. */
    roadMetres: { type: Number, required: true },

    /** Ride time in seconds. Stored beside the distance because one request returns both. */
    seconds: { type: Number, required: true },

    /** Which router answered, so a cache built by one is identifiable after a switch. */
    provider: { type: String, required: true },

    /**
     * Shorter than the geocode cache's ninety days.
     *
     * A geocode is a fact about where a building is. A route is a fact about the road
     * network between two points, and that does change — a new link road or a closure
     * can move a ride time materially, and thirty days bounds how long a stale answer
     * can keep quoting a customer the wrong number.
     */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
)

routeCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

/**
 * Five decimal places is about a metre.
 *
 * Far finer than any route differs by, so two pins a doorstep apart share an entry, while
 * the key stays honest enough that it could never conflate two different addresses.
 */
export function routeCacheKey({ lat, lng }, branchId) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}:${String(branchId)}`
}

export const RouteCache = mongoose.model('RouteCache', routeCacheSchema)
