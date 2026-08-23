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

    /**
     * Wait for every index to exist before any test runs a query.
     *
     * Mongoose builds indexes in the BACKGROUND on first use, so a suite can issue its
     * first query before they are ready. Most queries do not care — they just run
     * unindexed and are slower. `$geoNear` is the exception: it is not an optimisation
     * there but a requirement, and without the 2dsphere index on `Branch.location` it
     * fails outright with "$geoNear requires a 2d or 2dsphere index".
     *
     * That made branch-assignment tests fail intermittently, and only when the machine
     * was busy enough for the race to be lost — which is the worst kind of flake, because
     * it looks like the code under test and disappears when you go looking for it.
     *
     * `Model.init()` resolves once a model's indexes are built. Every model imported by
     * the suite is registered by now: ES module imports are evaluated before the
     * top-level await that calls this.
     */
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()))

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
