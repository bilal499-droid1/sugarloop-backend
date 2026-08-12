import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { STAFF_ROLE } from '../config/constants.js'

/**
 * Cost 12, as specified. Roughly 250ms on Render's shared CPU: slow enough that an
 * offline attack on a leaked dump is expensive, fast enough that a login doesn't feel
 * broken. Raise it when the hardware improves — existing hashes carry their own cost
 * and keep verifying.
 */
const BCRYPT_ROUNDS = 12

/** Lock the account after this many consecutive failures. */
const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60_000

const staffUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Must be a valid email address'],
    },

    /**
     * `select: false` so the hash is absent from every query that doesn't ask for it.
     * A hash that is never loaded is a hash that cannot be logged, serialised into a
     * response, or leaked by a `res.json(user)` written in a hurry.
     */
    passwordHash: { type: String, required: true, select: false },

    role: {
      type: String,
      required: true,
      enum: Object.values(STAFF_ROLE),
      default: STAFF_ROLE.BRANCH_MANAGER,
    },

    /**
     * Required for a branch_manager, null for an admin.
     *
     * An admin must NOT carry a branch, otherwise "scoped to one branch" and "sees
     * everything" are both true at once and authorisation depends on which one the
     * calling code happens to read first.
     */
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },

    isActive: { type: Boolean, default: true },

    lastLoginAt: { type: Date, default: null },

    // Throttling state for credential stuffing. Per-account, and deliberately separate
    // from the per-IP rate limiter — an attacker spreading one password across many
    // IPs defeats the IP limit but still trips this.
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  {
    // Named in plan §3. Mongoose would otherwise pluralise the model to 'staffusers'.
    collection: 'staffUsers',
    timestamps: true,
    toJSON: { virtuals: true, transform: stripInternals },
    toObject: { virtuals: true, transform: stripInternals },
  }
)

function stripInternals(_doc, ret) {
  delete ret._id
  delete ret.__v
  // Belt and braces. `select: false` already keeps the hash out, but a future
  // `.select('+passwordHash')` on a path that then serialises must not leak it.
  delete ret.passwordHash
  delete ret.failedLoginAttempts
  delete ret.lockedUntil
  return ret
}

staffUserSchema.path('branchId').validate(function branchMatchesRole(value) {
  if (this.role === STAFF_ROLE.BRANCH_MANAGER) return Boolean(value)
  return value === null || value === undefined
}, 'A branch manager must have a branch; an admin must not have one')

/** Hash on the way in, so no caller is ever responsible for remembering to. */
staffUserSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('passwordHash')) return next()
  // Skip anything already hashed — re-hashing a hash silently breaks every login.
  if (this.passwordHash.startsWith('$2')) return next()
  this.passwordHash = await bcrypt.hash(this.passwordHash, BCRYPT_ROUNDS)
  next()
})

staffUserSchema.methods.verifyPassword = function verifyPassword(plainText) {
  return bcrypt.compare(plainText, this.passwordHash)
}

staffUserSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now())
}

/**
 * Record a failed attempt, locking the account once the threshold is crossed.
 * Uses a direct update rather than save() so it cannot trip the password pre-save hook.
 */
staffUserSchema.methods.registerFailedLogin = async function registerFailedLogin() {
  const attempts = this.failedLoginAttempts + 1
  const update = { failedLoginAttempts: attempts }
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    update.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS)
    update.failedLoginAttempts = 0
  }
  Object.assign(this, update)
  await this.constructor.updateOne({ _id: this._id }, { $set: update })
}

staffUserSchema.methods.registerSuccessfulLogin = async function registerSuccessfulLogin() {
  const update = { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }
  Object.assign(this, update)
  await this.constructor.updateOne({ _id: this._id }, { $set: update })
}

export const StaffUser = mongoose.model('StaffUser', staffUserSchema)
export { MAX_FAILED_ATTEMPTS, LOCK_DURATION_MS, BCRYPT_ROUNDS }
