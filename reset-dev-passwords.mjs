/**
 * One-off dev helper: set a known password on the seeded staff accounts.
 *
 * The seed deliberately never touches an existing account's password, so once the
 * generated one is lost there is no way back in without this. Assigns to
 * `passwordHash` because the model's pre-save hook is what hashes that path — the
 * value is plain for exactly as long as save() takes to run.
 *
 * Delete this file after use. It is not part of the API.
 */
import { connectDatabase, disconnectDatabase } from './src/config/db.js'
import { StaffUser } from './src/models/StaffUser.js'

const PASSWORD = process.argv[2]

if (!PASSWORD || PASSWORD.length < 12) {
  console.error('Usage: node reset-dev-passwords.mjs <password of at least 12 chars>')
  process.exit(1)
}

await connectDatabase()

// `passwordHash` is `select: false` on the schema, so it has to be asked for explicitly
// before a save can write it back.
const users = await StaffUser.find({ email: /@sugarloop\.pk$/ }).select('+passwordHash')

for (const user of users) {
  user.passwordHash = PASSWORD
  // A wrong-password lockout from earlier guessing would survive the reset otherwise.
  user.failedLoginAttempts = 0
  user.lockedUntil = null
  user.isActive = true
  await user.save()
  console.log(`  reset  ${user.email.padEnd(32)} ${user.role}`)
}

console.log(`\n${users.length} accounts now use: ${PASSWORD}`)

await disconnectDatabase()
