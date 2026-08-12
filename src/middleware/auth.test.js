import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { STAFF_ROLE } from '../config/constants.js'
import { canAccessBranch, assertBranchAccess } from './auth.js'

const DHA1 = new mongoose.Types.ObjectId()
const DHA2 = new mongoose.Types.ObjectId()

const admin = { role: STAFF_ROLE.ADMIN, branchId: null }
const manager = (branchId) => ({ role: STAFF_ROLE.BRANCH_MANAGER, branchId })

test('an admin reaches every branch', () => {
  assert.equal(canAccessBranch(admin, DHA1), true)
  assert.equal(canAccessBranch(admin, DHA2), true)
})

test('a branch manager reaches exactly their own', () => {
  assert.equal(canAccessBranch(manager(DHA1), DHA1), true)
  assert.equal(canAccessBranch(manager(DHA1), DHA2), false)
})

test('a manager with no branch reaches nothing', () => {
  // Should be impossible — the StaffUser model requires a branch for this role — but a
  // missing branch must fail closed rather than compare null to null and pass.
  assert.equal(canAccessBranch(manager(null), DHA1), false)
  assert.equal(canAccessBranch(manager(undefined), DHA1), false)
})

test('a missing target branch is refused, not waved through', () => {
  assert.equal(canAccessBranch(manager(DHA1), null), false)
  assert.equal(canAccessBranch(manager(DHA1), undefined), false)
})

/**
 * The regression this file mainly exists for.
 *
 * `String(populatedDocument)` does not yield its _id, so a plain string comparison breaks
 * the moment anyone adds `.populate('branchId')` upstream — which is a natural thing to
 * do, and which `requireStaff` now actually does.
 */
test('comparison survives a populated branchId', async (t) => {
  const populated = { _id: DHA1, code: 'DHA1', name: 'Sugarloop DHA Phase 1' }

  await t.test('populated on the staff user', () => {
    assert.equal(canAccessBranch(manager(populated), DHA1), true)
    assert.equal(canAccessBranch(manager(populated), DHA2), false)
  })

  await t.test('populated on the target', () => {
    assert.equal(canAccessBranch(manager(DHA1), populated), true)
    assert.equal(canAccessBranch(manager(DHA2), populated), false)
  })

  await t.test('populated on both sides', () => {
    assert.equal(canAccessBranch(manager(populated), populated), true)
  })
})

test('ids compare equal across ObjectId and string forms', () => {
  assert.equal(canAccessBranch(manager(DHA1), String(DHA1)), true)
  assert.equal(canAccessBranch(manager(String(DHA1)), DHA1), true)
})

test('assertBranchAccess throws a 403, not a 401', () => {
  assert.doesNotThrow(() => assertBranchAccess(manager(DHA1), DHA1))

  assert.throws(
    () => assertBranchAccess(manager(DHA1), DHA2),
    // 403: they are authenticated, just not entitled. 401 would tell a client to re-login,
    // which will not help and loops the dashboard.
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN'
  )
})
