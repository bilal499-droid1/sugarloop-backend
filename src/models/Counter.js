import mongoose from 'mongoose'

/**
 * Atomic sequence numbers. Today there is exactly one user: order numbers.
 *
 * The naive alternative — `count()` the orders and add one — produces duplicates the
 * first time two customers check out in the same second, because both read the same count
 * before either writes. This collection exists so the increment and the read are a single
 * atomic operation the database performs, not two operations the application interleaves.
 *
 * One document per key, and the key is date-scoped (`order:260810`), so the sequence
 * restarts each day and yesterday's rows stop being touched.
 */
const counterSchema = new mongoose.Schema(
  {
    /** e.g. 'order:260810'. Supplied, not generated — the caller owns the namespace. */
    _id: { type: String, required: true },

    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, timestamps: true }
)

/**
 * The next value for `key`, atomically.
 *
 * `findOneAndUpdate` with `$inc` and `upsert` is one round trip and one atomic document
 * update: concurrent callers are serialised by the database and each receives a distinct
 * number. `new: true` returns the incremented value rather than the value before it.
 */
counterSchema.statics.next = async function next(key) {
  const counter = await this.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  return counter.seq
}

export const Counter = mongoose.model('Counter', counterSchema)
