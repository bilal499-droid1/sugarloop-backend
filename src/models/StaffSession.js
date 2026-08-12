import mongoose from 'mongoose'

/**
 * One refresh token, server-side.
 *
 * The refresh token itself is opaque random bytes, not a JWT, and only its SHA-256
 * hash is stored. That combination is what makes a staff session revocable: a stateless
 * refresh JWT stays valid until it expires no matter what the database says, so
 * "log this person out now" would be a promise the API could not keep.
 *
 * SHA-256 rather than bcrypt is deliberate. Bcrypt's cost exists to slow down guessing
 * of low-entropy human passwords; a 384-bit random token has nothing to guess, and a
 * per-request bcrypt on the refresh path would just be latency.
 */
const staffSessionSchema = new mongoose.Schema(
  {
    staffUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffUser',
      required: true,
      index: true,
    },

    tokenHash: { type: String, required: true, unique: true },

    expiresAt: { type: Date, required: true },

    /** Set on rotation or logout. A session with this set must never be accepted again. */
    revokedAt: { type: Date, default: null },

    /** The session that replaced this one, for tracing a rotation chain after a reuse. */
    replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffSession', default: null },

    // Not used for authorisation — a client controls both of these and can say anything.
    // They exist so a human reading the session list can recognise their own devices.
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  { timestamps: true }
)

/**
 * Mongo drops documents shortly after expiresAt, so dead sessions don't accumulate
 * forever. The purge is a housekeeping convenience only — expiry is still checked in
 * code, because the TTL monitor runs about once a minute and is not a security control.
 */
staffSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const StaffSession = mongoose.model('StaffSession', staffSessionSchema)
