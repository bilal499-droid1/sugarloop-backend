/**
 * Resets staff passwords. For when the seeded password is lost — the seed prints a
 * generated one exactly once, and only for accounts it actually creates, so a re-seed
 * against existing accounts (`Staff: 0 created, 5 updated`) reveals nothing and changes
 * nothing.
 *
 *   npm run staff:password -- --all                     every staff account
 *   npm run staff:password -- admin@sugarloop.pk        one account
 *   npm run staff:password -- a@x.pk b@x.pk             several
 *
 * The password comes from STAFF_PASSWORD, or is generated and printed if that is unset:
 *
 *   STAFF_PASSWORD='...' npm run staff:password -- --all
 *
 * Refuses to run outside development unless --force is passed, because the whole point
 * of this script is overwriting a password somebody may be relying on.
 */
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { StaffUser } from '../models/StaffUser.js'

const MIN_PASSWORD_LENGTH = 8

function parseArguments(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
  const emails = argv.filter((arg) => !arg.startsWith('--')).map((email) => email.toLowerCase())

  return { all: flags.has('--all'), force: flags.has('--force'), emails }
}

async function resetPasswords() {
  const { all, force, emails } = parseArguments(process.argv.slice(2))

  if (!all && emails.length === 0) {
    logger.fatal('Nothing to do. Pass --all, or one or more email addresses.')
    process.exit(1)
  }

  if (!env.isDevelopment && !force) {
    logger.fatal(
      `Refusing to reset passwords with NODE_ENV=${env.NODE_ENV}. Pass --force if you mean it.`
    )
    process.exit(1)
  }

  const provided = process.env.STAFF_PASSWORD

  if (provided && provided.length < MIN_PASSWORD_LENGTH) {
    logger.fatal(`STAFF_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)
    process.exit(1)
  }

  // Same shape the seed generates, for the same reason: a hardcoded default would be
  // identical on every install and would eventually be typed into production.
  const password = provided ?? `dev-${crypto.randomBytes(9).toString('base64url')}`

  await connectDatabase()

  // `+passwordHash` because the field is `select: false` on the schema. Without it the
  // loaded document has no password at all, and save() fails validation on a required
  // field rather than writing the new one.
  const filter = all ? {} : { email: { $in: emails } }
  const users = await StaffUser.find(filter).select('+passwordHash')

  if (users.length === 0) {
    logger.fatal(all ? 'No staff accounts exist' : `No staff account matches ${emails.join(', ')}`)
    await disconnectDatabase()
    process.exit(1)
  }

  if (!all) {
    const found = new Set(users.map((user) => user.email))
    const missing = emails.filter((email) => !found.has(email))
    // Reported, not fatal: the accounts that DO exist are still worth resetting, and a
    // typo in one address should not silently look like a total failure.
    if (missing.length > 0) logger.warn(`No such staff account: ${missing.join(', ')}`)
  }

  for (const user of users) {
    // Assigned to passwordHash because the pre-save hook hashes that path. It is the
    // plain password for exactly as long as it takes save() to run.
    //
    // save(), never findOneAndUpdate(): the hook does not run on a direct update, which
    // would write this straight to the database in clear text.
    user.passwordHash = password

    // Cleared together with the password, because whoever is running this has almost
    // certainly just failed five logins guessing at the old one — and the account
    // locks for 15 minutes at that point. A correct new password that still cannot
    // sign in would look exactly like the reset having failed.
    user.failedLoginAttempts = 0
    user.lockedUntil = null

    await user.save()
    logger.info(`Reset: ${user.email} (${user.role})`)
  }

  if (provided) {
    logger.info(`${users.length} account(s) reset to the supplied STAFF_PASSWORD`)
  } else {
    logger.warn(`${users.length} account(s) reset. Password (shown once): ${password}`)
  }
}

resetPasswords()
  .then(async () => {
    await disconnectDatabase()
    process.exit(0)
  })
  .catch(async (err) => {
    logger.fatal({ err }, 'Password reset failed')
    // Best effort — the connection may be the thing that broke.
    if (mongoose.connection.readyState === 1) await disconnectDatabase().catch(() => {})
    process.exit(1)
  })
