import test from 'node:test'
import assert from 'node:assert/strict'

import { StaffUser } from '../models/StaffUser.js'
import { StaffSession } from '../models/StaffSession.js'
import { Branch } from '../models/Branch.js'
import { AuditLog } from '../models/AuditLog.js'
import { STAFF_ROLE } from '../config/constants.js'
import * as staffUserService from './staffUser.service.js'
import * as staffAuthService from './staffAuth.service.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Integration tests for staff account administration.
 *
 * The rules here are the ones that decide who can get into the system at all, so they are
 * worth more coverage than most: the guard that stops the last admin being removed, the
 * guards that stop an admin locking themselves out by hand, and the role/branch pairing
 * that keeps "sees everything" and "sees one shop" from both being true of one account.
 *
 * SKIPS rather than fails when Mongo is unreachable, matching the other integration
 * suites. See testing/mongoTestDb.js.
 */
const { connected, skip } = await connectTestDatabase('staffUser')

const PASSWORD = 'FixturePassw0rd!'

let dha1
let dha2
let admin
let secondAdmin
let manager

const branchFixture = (code, name, coordinates) => ({
  code,
  name,
  address: 'Somewhere in Islamabad',
  city: 'Islamabad',
  phone: '+92 51 111 557 799',
  location: { type: 'Point', coordinates },
  hours: { open: '11:00', close: '03:00' },
  lastOrderBufferMinutes: 30,
})

async function seedFixtures() {
  await Promise.all([
    StaffUser.deleteMany({}),
    StaffSession.deleteMany({}),
    Branch.deleteMany({}),
    AuditLog.deleteMany({}),
  ])
  ;[dha1, dha2] = await Branch.create([
    branchFixture('DHA1', 'Sugarloop DHA Phase 1', [73.1574, 33.5312]),
    branchFixture('DHA2', 'Sugarloop DHA Phase 2', [73.1701, 33.5218]),
  ])

  admin = await StaffUser.create({
    name: 'Sugarloop Admin',
    email: 'admin@sugarloop.pk',
    passwordHash: PASSWORD,
    role: STAFF_ROLE.ADMIN,
    branchId: null,
  })

  secondAdmin = await StaffUser.create({
    name: 'Second Admin',
    email: 'admin2@sugarloop.pk',
    passwordHash: PASSWORD,
    role: STAFF_ROLE.ADMIN,
    branchId: null,
  })

  manager = await StaffUser.create({
    name: 'DHA 1 Manager',
    email: 'dha1.manager@sugarloop.pk',
    passwordHash: PASSWORD,
    role: STAFF_ROLE.BRANCH_MANAGER,
    branchId: dha1._id,
  })
}

/** The `{ actor, ip }` every write takes, for auditing and the self-guards. */
const asAdmin = () => ({ actor: admin, ip: '127.0.0.1' })

const rejectsWith = (statusCode, matcher) => (error) => {
  assert.equal(error.statusCode, statusCode)
  if (matcher) assert.match(error.message, matcher)
  return true
}

test('staff user administration', { skip, concurrency: false }, async (t) => {
  t.after(() => disconnectTestDatabase(connected))
  t.beforeEach(seedFixtures)

  await t.test('role and branch must agree', async (t) => {
    await t.test('a branch manager without a branch is refused', async () => {
      await assert.rejects(
        staffUserService.create(
          {
            name: 'Nobody',
            email: 'nobody@sugarloop.pk',
            password: PASSWORD,
            role: STAFF_ROLE.BRANCH_MANAGER,
          },
          asAdmin()
        ),
        rejectsWith(422, /must be assigned to a branch/i)
      )
    })

    await t.test('an admin carrying a branch is refused', async () => {
      await assert.rejects(
        staffUserService.create(
          {
            name: 'Nobody',
            email: 'nobody@sugarloop.pk',
            password: PASSWORD,
            role: STAFF_ROLE.ADMIN,
            branchId: String(dha1._id),
          },
          asAdmin()
        ),
        rejectsWith(422, /cannot be assigned to a branch/i)
      )
    })

    await t.test('a branch that does not exist is refused', async () => {
      await assert.rejects(
        staffUserService.create(
          {
            name: 'Nobody',
            email: 'nobody@sugarloop.pk',
            password: PASSWORD,
            role: STAFF_ROLE.BRANCH_MANAGER,
            branchId: '0'.repeat(24),
          },
          asAdmin()
        ),
        rejectsWith(422, /unknown branch|does not exist/i)
      )
    })

    await t.test('promoting a manager to admin clears their branch', async () => {
      const promoted = await staffUserService.update(
        manager._id,
        { role: STAFF_ROLE.ADMIN },
        asAdmin()
      )

      assert.equal(promoted.role, STAFF_ROLE.ADMIN)
      assert.equal(promoted.branchId, null)
    })

    await t.test('moving a manager between branches keeps the role', async () => {
      const moved = await staffUserService.update(
        manager._id,
        { branchId: String(dha2._id) },
        asAdmin()
      )

      assert.equal(moved.role, STAFF_ROLE.BRANCH_MANAGER)
      assert.equal(String(moved.branchId._id ?? moved.branchId), String(dha2._id))
    })
  })

  await t.test('the system can never be left without an admin', async (t) => {
    await t.test('the last active admin cannot be demoted', async () => {
      // Leaves `admin` as the only active admin.
      await staffUserService.deactivate(secondAdmin._id, asAdmin())

      await assert.rejects(
        staffUserService.update(
          admin._id,
          { role: STAFF_ROLE.BRANCH_MANAGER, branchId: String(dha1._id) },
          { actor: secondAdmin, ip: '' }
        ),
        rejectsWith(409, /last active admin/i)
      )
    })

    await t.test('the last active admin cannot be switched off', async () => {
      await staffUserService.deactivate(secondAdmin._id, asAdmin())

      await assert.rejects(
        staffUserService.deactivate(admin._id, { actor: secondAdmin, ip: '' }),
        rejectsWith(409, /last active admin/i)
      )
    })

    await t.test('a second active admin makes both operations legal', async () => {
      const demoted = await staffUserService.update(
        secondAdmin._id,
        { role: STAFF_ROLE.BRANCH_MANAGER, branchId: String(dha1._id) },
        asAdmin()
      )

      assert.equal(demoted.role, STAFF_ROLE.BRANCH_MANAGER)
    })

    await t.test('an inactive admin does not count as a way back in', async () => {
      // secondAdmin exists but is switched off, so `admin` is still the only way in.
      await staffUserService.deactivate(secondAdmin._id, asAdmin())

      await assert.rejects(
        staffUserService.deactivate(admin._id, { actor: secondAdmin, ip: '' }),
        rejectsWith(409, /last active admin/i)
      )
    })
  })

  await t.test('an admin cannot lock themselves out by hand', async (t) => {
    await t.test('cannot change their own role', async () => {
      await assert.rejects(
        staffUserService.update(
          admin._id,
          { role: STAFF_ROLE.BRANCH_MANAGER, branchId: String(dha1._id) },
          asAdmin()
        ),
        rejectsWith(403, /your own account/i)
      )
    })

    await t.test('cannot switch themselves off through update', async () => {
      await assert.rejects(
        staffUserService.update(admin._id, { isActive: false }, asAdmin()),
        rejectsWith(403, /your own account/i)
      )
    })

    await t.test('cannot switch themselves off through delete', async () => {
      await assert.rejects(
        staffUserService.deactivate(admin._id, asAdmin()),
        rejectsWith(403, /your own account/i)
      )
    })

    await t.test('can still rename themselves', async () => {
      const renamed = await staffUserService.update(admin._id, { name: 'The Boss' }, asAdmin())
      assert.equal(renamed.name, 'The Boss')
    })
  })

  await t.test('changes that affect access end the sessions that predate them', async (t) => {
    /** Signs the manager in for real, so the sessions are the ones login creates. */
    const signInManager = () =>
      staffAuthService.login({
        email: 'dha1.manager@sugarloop.pk',
        password: PASSWORD,
        context: { ip: '', userAgent: 'test' },
      })

    const sessionIsDead = async (refreshToken) => {
      await assert.rejects(
        staffAuthService.refresh({ refreshToken, context: {} }),
        (error) => error.statusCode === 401 || error.statusCode === 403
      )
    }

    await t.test('a role change signs them out', async () => {
      const { refreshToken } = await signInManager()
      await staffUserService.update(manager._id, { role: STAFF_ROLE.ADMIN }, asAdmin())
      await sessionIsDead(refreshToken)
    })

    await t.test('a branch move signs them out', async () => {
      const { refreshToken } = await signInManager()
      await staffUserService.update(manager._id, { branchId: String(dha2._id) }, asAdmin())
      await sessionIsDead(refreshToken)
    })

    await t.test('being switched off signs them out', async () => {
      const { refreshToken } = await signInManager()
      await staffUserService.deactivate(manager._id, asAdmin())
      await sessionIsDead(refreshToken)
    })

    await t.test('a password reset signs them out', async () => {
      const { refreshToken } = await signInManager()
      await staffUserService.resetPassword(manager._id, 'ResetPassw0rd!', asAdmin())
      await sessionIsDead(refreshToken)
    })

    await t.test('a rename does NOT sign them out', async () => {
      const { refreshToken } = await signInManager()
      await staffUserService.update(manager._id, { name: 'Renamed' }, asAdmin())

      const refreshed = await staffAuthService.refresh({ refreshToken, context: {} })
      assert.equal(refreshed.staffUser.name, 'Renamed')
    })
  })

  await t.test('a password reset', async (t) => {
    await t.test('replaces the password without needing the old one', async () => {
      await staffUserService.resetPassword(manager._id, 'ResetPassw0rd!', asAdmin())

      const signIn = (password) =>
        staffAuthService.login({
          email: 'dha1.manager@sugarloop.pk',
          password,
          context: {},
        })

      await assert.doesNotReject(signIn('ResetPassw0rd!'))
      await assert.rejects(signIn(PASSWORD))
    })

    await t.test('clears a lockout, which is usually why an admin is doing it', async () => {
      const locked = await StaffUser.findById(manager._id)
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await locked.registerFailedLogin()
      }
      assert.ok((await StaffUser.findById(manager._id)).isLocked(), 'precondition: locked')

      await staffUserService.resetPassword(manager._id, 'ResetPassw0rd!', asAdmin())

      assert.equal((await StaffUser.findById(manager._id)).isLocked(), false)
    })

    await t.test('never writes the new password to the audit trail', async () => {
      await staffUserService.resetPassword(manager._id, 'ResetPassw0rd!', asAdmin())

      const entry = await AuditLog.findOne({ action: 'staffUser.resetPassword' })
      assert.ok(entry, 'the reset is recorded')
      assert.equal(
        JSON.stringify(entry.toObject()).includes('ResetPassw0rd!'),
        false,
        'the password itself is not'
      )
    })
  })

  await t.test('deactivation is a soft delete', async () => {
    await staffUserService.deactivate(manager._id, asAdmin())

    // The row survives, because orders carry the id of the staff member who moved them
    // and an audit trail pointing at a missing document is not an audit trail.
    const stillThere = await StaffUser.findById(manager._id)
    assert.ok(stillThere)
    assert.equal(stillThere.isActive, false)
  })

  await t.test('a switched-off account can be switched back on', async () => {
    await staffUserService.deactivate(manager._id, asAdmin())
    const restored = await staffUserService.update(manager._id, { isActive: true }, asAdmin())

    assert.equal(restored.isActive, true)
    await assert.doesNotReject(
      staffAuthService.login({
        email: 'dha1.manager@sugarloop.pk',
        password: PASSWORD,
        context: {},
      })
    )
  })

  await t.test('every write leaves an audit row naming the actor', async () => {
    await staffUserService.create(
      {
        name: 'Ayesha Khan',
        email: 'ayesha@sugarloop.pk',
        password: PASSWORD,
        role: STAFF_ROLE.BRANCH_MANAGER,
        branchId: String(dha2._id),
      },
      asAdmin()
    )
    await staffUserService.update(manager._id, { name: 'Renamed' }, asAdmin())
    await staffUserService.deactivate(manager._id, asAdmin())

    const actions = await AuditLog.find({ entity: 'StaffUser' }).sort({ createdAt: 1 })
    assert.deepEqual(
      actions.map((row) => row.action),
      ['staffUser.create', 'staffUser.update', 'staffUser.deactivate']
    )
    for (const row of actions) {
      assert.equal(row.actorEmail, admin.email)
    }
  })

  /**
   * Regression: the write paths used to return a document straight out of `create()` or
   * `save()`, whose branchId is a bare ObjectId. `staffUserView` then emitted `{ id }`
   * with no name, so a console that renders the branch showed it everywhere EXCEPT right
   * after a write — which read as the write having cleared the branch.
   */
  await t.test('writes return the branch populated, like reads do', async (t) => {
    await t.test('on create', async () => {
      const created = await staffUserService.create(
        {
          name: 'Ayesha Khan',
          email: 'ayesha@sugarloop.pk',
          password: PASSWORD,
          role: STAFF_ROLE.BRANCH_MANAGER,
          branchId: String(dha2._id),
        },
        asAdmin()
      )

      assert.equal(created.branchId.code, 'DHA2')
      assert.equal(created.branchId.name, 'Sugarloop DHA Phase 2')
    })

    await t.test('on update', async () => {
      const updated = await staffUserService.update(
        manager._id,
        { branchId: String(dha2._id) },
        asAdmin()
      )
      assert.equal(updated.branchId.code, 'DHA2')
    })

    await t.test('on password reset', async () => {
      const reset = await staffUserService.resetPassword(manager._id, 'ResetPassw0rd!', asAdmin())
      assert.equal(reset.branchId.code, 'DHA1')
    })

    await t.test('on deactivate', async () => {
      const off = await staffUserService.deactivate(manager._id, asAdmin())
      assert.equal(off.branchId.code, 'DHA1')
    })

    await t.test('an admin still has no branch to populate', async () => {
      const renamed = await staffUserService.update(admin._id, { name: 'The Boss' }, asAdmin())
      assert.equal(renamed.branchId, null)
    })
  })

  await t.test('listing', async (t) => {
    await t.test('search matches name or email, case-insensitively', async () => {
      const byName = await staffUserService.list({ search: 'dha 1', limit: 50 })
      assert.deepEqual(
        byName.items.map((row) => row.email),
        ['dha1.manager@sugarloop.pk']
      )

      const byEmail = await staffUserService.list({ search: 'ADMIN2', limit: 50 })
      assert.deepEqual(
        byEmail.items.map((row) => row.email),
        ['admin2@sugarloop.pk']
      )
    })

    await t.test('a regex metacharacter in the search is a literal, not a pattern', async () => {
      // Without escaping, '.' matches any character and this would return everyone.
      const { items } = await staffUserService.list({ search: 'a.m.i.n', limit: 50 })
      assert.equal(items.length, 0)
    })

    await t.test('filters by role, branch and active status', async () => {
      await staffUserService.deactivate(secondAdmin._id, asAdmin())

      const admins = await staffUserService.list({ role: STAFF_ROLE.ADMIN, limit: 50 })
      assert.equal(admins.items.length, 2)

      const activeAdmins = await staffUserService.list({
        role: STAFF_ROLE.ADMIN,
        isActive: true,
        limit: 50,
      })
      assert.deepEqual(
        activeAdmins.items.map((row) => row.email),
        ['admin@sugarloop.pk']
      )

      const atDha1 = await staffUserService.list({ branchId: String(dha1._id), limit: 50 })
      assert.deepEqual(
        atDha1.items.map((row) => row.email),
        ['dha1.manager@sugarloop.pk']
      )
    })

    await t.test('pages with a cursor rather than an offset', async () => {
      const first = await staffUserService.list({ limit: 2 })
      assert.equal(first.items.length, 2)
      assert.ok(first.nextCursor)

      const second = await staffUserService.list({ limit: 2, cursor: first.nextCursor })
      assert.equal(second.items.length, 1)
      assert.equal(second.nextCursor, null)

      // No row appears on both pages.
      const seen = [...first.items, ...second.items].map((row) => String(row._id))
      assert.equal(new Set(seen).size, 3)
    })
  })

  await t.test('a missing account is a 404, not a crash', async () => {
    await assert.rejects(
      staffUserService.getById('0'.repeat(24)),
      rejectsWith(404, /not found/i)
    )
    await assert.rejects(
      staffUserService.update('0'.repeat(24), { name: 'X' }, asAdmin()),
      rejectsWith(404, /not found/i)
    )
  })
})
