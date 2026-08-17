import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { OTP } from '../config/constants.js'

/**
 * One phone-verification challenge (BACKEND-DESIGN §3, `otpSessions`).
 *
 * **The code itself is never stored.** Only a bcrypt hash of it, for the same reason a
 * password is hashed: this collection holds a live credential for every customer
 * currently checking out, and a database dump that contained plaintext codes would be a
 * dump of working logins. Bcrypt rather than SHA-256 here — unlike a 384-bit session
 * token, a six-digit code has only a million possibilities, so an attacker with the
 * hashes could exhaust the space instantly against a fast digest. The cost is paid once
 * per verify attempt, which is a human typing, not a hot path.
 *
 * Cost 10 rather than the 12 used for staff passwords: a code lives five minutes and
 * dies after five wrong guesses, so the work factor is buying far less here, and verify
 * sits directly in a checkout the customer is waiting on.
 */
const BCRYPT_COST = 10

const otpChallengeSchema = new mongoose.Schema(
  {
    /** E.164, normalised by the validator before it ever reaches this model. */
    phone: { type: String, required: true, index: true },

    codeHash: { type: String, required: true },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: OTP.MAX_ATTEMPTS },

    expiresAt: { type: Date, required: true },

    /**
     * Set the moment a code is accepted. A consumed challenge must never verify again —
     * without this, one code intercepted once would keep working until it expired.
     */
    consumedAt: { type: Date, default: null },

    /** For abuse investigation. Never used for authorisation. */
    ip: { type: String, default: '' },
  },
  { timestamps: true }
)

/**
 * Find the live challenge for a phone, newest first.
 *
 * Requesting a second code does not delete the first — deleting would make a stale
 * message able to invalidate a fresh one out of order. Instead the newest wins, and the
 * older ones simply age out.
 */
otpChallengeSchema.index({ phone: 1, createdAt: -1 })

/**
 * Mongo purges expired challenges automatically. This is housekeeping, not a security
 * control — the TTL monitor only runs about once a minute, so expiry is checked in code
 * as well and never inferred from the row still being present.
 */
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

otpChallengeSchema.statics.hashCode = function hashCode(code) {
  return bcrypt.hash(code, BCRYPT_COST)
}

otpChallengeSchema.methods.matches = function matches(code) {
  return bcrypt.compare(code, this.codeHash)
}

/** Live means: not used, not expired, and not out of attempts. */
otpChallengeSchema.methods.isUsable = function isUsable(now = new Date()) {
  return !this.consumedAt && this.expiresAt > now && this.attempts < this.maxAttempts
}

export const OtpChallenge = mongoose.model('OtpChallenge', otpChallengeSchema)
