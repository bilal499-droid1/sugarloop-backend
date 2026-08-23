import test from 'node:test'
import assert from 'node:assert/strict'

import { StaffUser } from '../models/StaffUser.js'
import { StaffSession } from '../models/StaffSession.js'
import { Branch } from '../models/Branch.js'
import { STAFF_ROLE } from '../config/constants.js'
import * as staffAuthService from './staffAuth.service.js'
import { changePasswordSchema } from '../validators/staffAuth.validator.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Integration tests for self-service password change — the one credential operation a
 * staff member can perform on their own account.
 *
 * SKIPS rather than fails when Mongo is unreachable, matching the other integration
 * suites. See testing/mongoTestDb.js.
 */
const { connected, skip } = await connectTestDatabase('staffAuth')

const CURRENT = 'CurrentPassw0rd!'
const NEXT = 'BrandNewPassw0rd!'

let branch
let manager

async function seedFixtures() {
  await Promise.all([
    StaffUser.deleteMany({}),
    StaffSession.deleteMany({}),
    Branch.deleteMany({}),
  ])

  branch = await Branch.create({
    code: 'DHA1',
    name: 'Sugarloop DHA Phase 1',
    address: 'Somewhere in Islamabad',
    city: 'Islamabad',
    phone: '+92 51 111 557 799',
    location: { type: 'Point', coordinates: [73.1574, 33.5312] },
    hours: { open: '11:00', close: '03:00' },
    lastOrderBufferMinutes: 30,
  })

  manager = await StaffUser.create({
    name: 'Bilal',
    email: 'dha1.manager@sugarloop.pk',
    passwordHash: CURRENT,
    role: STAFF_ROLE.BRANCH_MANAGER,
    branchId: branch._id,
  })
}

/** Signs in for real, so the sessions under test are the ones login actually creates. */
function signIn(password = CURRENT) {
  return staffAuthService.login({
    email: 'dha1.manager@sugarloop.pk',
    password,
    context: { ip: '127.0.0.1', userAgent: 'test' },
  })
}

test('staff password change', { skip, concurrency: false }, async (t) => {
  t.after(() => disconnectTestDatabase(connected))
  t.beforeEach(seedFixtures)

  await t.test('rejects a wrong current password and changes nothing', async () => {
    await assert.rejects(
      staffAuthService.changePassword(manager._id, {
        currentPassword: 'NotTheirPassword!',
        newPassword: NEXT,
      }),
      (error) => {
        assert.equal(error.statusCode, 401)
        assert.equal(error.code, 'INVALID_PASSWORD')
        return true
      }
    )

    // The old password must still work — a failed change that quietly half-applied
    // would lock someone out of their own account.
    await assert.doesNotReject(signIn())
  })

  await t.test('the new password works and the old one stops working', async () => {
    await staffAuthService.changePassword(manager._id, {
      currentPassword: CURRENT,
      newPassword: NEXT,
    })

    await assert.doesNotReject(signIn(NEXT))
    await assert.rejects(signIn(CURRENT), (error) => {
      assert.equal(error.statusCode, 401)
      return true
    })
  })

  await t.test('every other session is revoked', async () => {
    // Two devices signed in — a phone in the kitchen and a laptop out back.
    const phone = await signIn()
    const laptop = await signIn()

    await staffAuthService.changePassword(manager._id, {
      currentPassword: CURRENT,
      newPassword: NEXT,
    })

    for (const device of [phone, laptop]) {
      await assert.rejects(
        staffAuthService.refresh({ refreshToken: device.refreshToken, context: {} }),
        (error) => {
          assert.equal(error.statusCode, 401)
          return true
        }
      )
    }
  })

  await t.test('the session it returns is usable, so the caller stays signed in', async () => {
    const { refreshToken } = await staffAuthService.changePassword(manager._id, {
      currentPassword: CURRENT,
      newPassword: NEXT,
    })

    const refreshed = await staffAuthService.refresh({ refreshToken, context: {} })
    assert.equal(refreshed.staffUser.email, 'dha1.manager@sugarloop.pk')
    assert.ok(refreshed.accessToken)
  })

  await t.test('clears a lockout, since the caller proved the password', async () => {
    // Five bad guesses locks the account (models/StaffUser.js).
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(signIn('WrongPassword!'))
    }

    const locked = await StaffUser.findById(manager._id)
    assert.ok(locked.isLocked(), 'precondition: the account is locked')

    await staffAuthService.changePassword(manager._id, {
      currentPassword: CURRENT,
      newPassword: NEXT,
    })

    const after = await StaffUser.findById(manager._id)
    assert.equal(after.isLocked(), false)
    assert.equal(after.failedLoginAttempts, 0)
    await assert.doesNotReject(signIn(NEXT))
  })

  await t.test('the branch is populated, so the response can name it', async () => {
    const { staffUser } = await staffAuthService.changePassword(manager._id, {
      currentPassword: CURRENT,
      newPassword: NEXT,
    })

    assert.equal(staffUser.branchId.code, 'DHA1')
  })
})

/**
 * Schema-level, so no database is needed — these run everywhere, including on a laptop
 * with no Mongo.
 */
test('changePasswordSchema', async (t) => {
  await t.test('refuses a new password identical to the current one', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: CURRENT,
      newPassword: CURRENT,
    })

    assert.equal(result.success, false)
    assert.equal(result.error.issues[0].path[0], 'newPassword')
  })

  await t.test('applies the shared length policy to the new password only', () => {
    // Short current password: legitimate, it predates the policy or is simply wrong,
    // and either way it is being verified rather than set.
    assert.equal(
      changePasswordSchema.safeParse({ currentPassword: 'short', newPassword: NEXT }).success,
      true
    )

    assert.equal(
      changePasswordSchema.safeParse({ currentPassword: CURRENT, newPassword: 'short' }).success,
      false
    )
  })

  await t.test('refuses a new password over bcrypt 72-byte limit', () => {
    assert.equal(
      changePasswordSchema.safeParse({ currentPassword: CURRENT, newPassword: 'a'.repeat(73) })
        .success,
      false
    )
  })
})
