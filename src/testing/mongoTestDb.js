/**
 * A private MongoDB database per integration test file.
 *
 * `node --test` runs each test FILE in its own process, in parallel. Three suites that
 * all `deleteMany` their fixtures against one shared database will delete each other's
 * rows mid-test, and the failures land wherever the timing happens to put them — a suite
 * that passes alone and fails in `npm test` is the worst kind of flake to chase. Suffixing
 * the database name per suite makes the isolation structural rather than a rule to
 * remember when the next integration file is added.
 *
 * Lives in `src/testing/` rather than `src/test/`: the test runner treats any directory
 * named `test` as test files and would try to run this helper as a suite.
 */
import mongoose from 'mongoose'

const DEFAULT_URI = 'mongodb://127.0.0.1:27017/sugarloop_test'

/** The configured URI with `_<suite>` appended to the database name. */
export function testDatabaseUri(suite) {
  const uri = new URL(process.env.MONGODB_TEST_URI ?? DEFAULT_URI)
  const name = uri.pathname.replace(/^\//, '') || 'sugarloop_test'

  uri.pathname = `/${name}_${suite}`

  return uri.toString()
}

/**
 * Connects, or reports that it could not.
 *
 * Never throws: a missing Mongo means these tests SKIP, so `npm test` stays green on a
 * laptop without one. CI runs a Mongo service, where they actually execute.
 */
export async function connectTestDatabase(suite) {
  try {
    await mongoose.connect(testDatabaseUri(suite), { serverSelectionTimeoutMS: 2000 })
    return { connected: true, skip: false }
  } catch {
    return { connected: false, skip: 'MongoDB unreachable — integration tests skipped' }
  }
}

/** Drops the suite's database and disconnects. Safe to call when never connected. */
export async function disconnectTestDatabase(connected) {
  if (!connected) return

  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}
