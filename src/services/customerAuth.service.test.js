/**
 * The OTP rules.
 *
 * These tests are the reason the flow can be trusted before a single WhatsApp message has
 * ever been sent: they exercise expiry, attempt limits, replay, cooldown and the hourly
 * cap directly, with time injected rather than waited for.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.OTP_TRANSPORT ??= 'log'
process.env.JWT_CUSTOMER_SECRET ??= 'test-customer-secret-at-least-16-chars'
process.env.JWT_STAFF_SECRET ??= 'test-staff-secret-at-least-16-chars-x'
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/sugarloop_test'

const { connectTestDatabase, disconnectTestDatabase } = await import('../testing/mongoTestDb.js')
const { connected, skip } = await connectTestDatabase('customerauth')

const { OtpChallenge } = await import('../models/OtpChallenge.js')
const { OTP } = await import('../config/constants.js')
const service = await import('./customerAuth.service.js')

const PHONE = '+923001234567'

/** The code never leaves the service except through the dev echo, which is what we read. */
async function issueCode(phone = PHONE, now = new Date()) {
  const result = await service.requestOtp({ phone }, { now })
  assert.ok(result.devCode, 'dev transport should echo the code so tests can use it')
  return result.devCode
}

test.beforeEach(async () => {
  if (connected) await OtpChallenge.deleteMany({})
})

test.after(async () => {
  await disconnectTestDatabase(connected)
})

test('a fresh code verifies and returns a session', { skip }, async () => {
  const code = await issueCode()
  const session = await service.verifyOtp({ phone: PHONE, code })

  assert.equal(session.phone, PHONE)
  assert.ok(session.token)

  const payload = service.verifyCustomerToken(session.token)
  assert.equal(payload.phone, PHONE)
})

test('the plain code is never stored', { skip }, async () => {
  const code = await issueCode()
  const stored = await OtpChallenge.findOne({ phone: PHONE })

  assert.notEqual(stored.codeHash, code)
  assert.ok(stored.codeHash.startsWith('$2'), 'should be a bcrypt hash')
})

test('a code cannot be used twice', { skip }, async () => {
  const code = await issueCode()
  await service.verifyOtp({ phone: PHONE, code })

  await assert.rejects(
    () => service.verifyOtp({ phone: PHONE, code }),
    (error) => error.code === 'OTP_INVALID'
  )
})

test('an expired code is refused', { skip }, async () => {
  const now = new Date()
  const code = await issueCode(PHONE, now)

  const afterExpiry = new Date(now.getTime() + (OTP.TTL_MINUTES + 1) * 60 * 1000)

  await assert.rejects(
    () => service.verifyOtp({ phone: PHONE, code }, { now: afterExpiry }),
    (error) => error.code === 'OTP_INVALID'
  )
})

test('a wrong code is refused and burns an attempt', { skip }, async () => {
  await issueCode()

  await assert.rejects(
    () => service.verifyOtp({ phone: PHONE, code: '000000' }),
    (error) => error.code === 'OTP_INVALID'
  )

  const stored = await OtpChallenge.findOne({ phone: PHONE })
  assert.equal(stored.attempts, 1)
})

test('the challenge dies after the attempt limit, and the right code no longer works', {
  skip,
}, async () => {
  const code = await issueCode()

  // Wrong guesses up to the limit. '000000' could in principle BE the code; make sure
  // the guess is always wrong so the test cannot flake one time in a million.
  const wrong = code === '000000' ? '111111' : '000000'

  for (let i = 0; i < OTP.MAX_ATTEMPTS; i += 1) {
    await assert.rejects(() => service.verifyOtp({ phone: PHONE, code: wrong }))
  }

  await assert.rejects(
    () => service.verifyOtp({ phone: PHONE, code }),
    (error) => error.code === 'OTP_ATTEMPTS_EXHAUSTED',
    'a burned challenge must not accept even the correct code'
  )
})

test('resending immediately is refused by the cooldown', { skip }, async () => {
  const now = new Date()
  await service.requestOtp({ phone: PHONE }, { now })

  await assert.rejects(
    () => service.requestOtp({ phone: PHONE }, { now: new Date(now.getTime() + 5_000) }),
    (error) => error.code === 'OTP_COOLDOWN' && error.details.retryAfterSeconds > 0
  )
})

test('the hourly per-phone cap is enforced', { skip }, async () => {
  const start = new Date()

  // Spaced past the cooldown so it is the hourly cap being tested, not the cooldown.
  for (let i = 0; i < OTP.MAX_PER_PHONE_PER_HOUR; i += 1) {
    const at = new Date(start.getTime() + i * (OTP.RESEND_COOLDOWN_SECONDS + 5) * 1000)
    await service.requestOtp({ phone: PHONE }, { now: at })
  }

  const next = new Date(
    start.getTime() + OTP.MAX_PER_PHONE_PER_HOUR * (OTP.RESEND_COOLDOWN_SECONDS + 5) * 1000
  )

  await assert.rejects(
    () => service.requestOtp({ phone: PHONE }, { now: next }),
    (error) => error.code === 'OTP_RATE_LIMITED'
  )
})

test('the cap is per phone, so one number cannot lock out another', { skip }, async () => {
  const start = new Date()
  const other = '+923009999999'

  for (let i = 0; i < OTP.MAX_PER_PHONE_PER_HOUR; i += 1) {
    const at = new Date(start.getTime() + i * (OTP.RESEND_COOLDOWN_SECONDS + 5) * 1000)
    await service.requestOtp({ phone: PHONE }, { now: at })
  }

  await assert.doesNotReject(() => service.requestOtp({ phone: other }, { now: start }))
})

test('requesting a second code does not invalidate it — the newest wins', { skip }, async () => {
  const start = new Date()
  await service.requestOtp({ phone: PHONE }, { now: start })

  const later = new Date(start.getTime() + (OTP.RESEND_COOLDOWN_SECONDS + 5) * 1000)
  const second = await service.requestOtp({ phone: PHONE }, { now: later })

  await assert.doesNotReject(() =>
    service.verifyOtp({ phone: PHONE, code: second.devCode }, { now: later })
  )
})

test('a staff-signed token is not a customer session', { skip }, async () => {
  // Different secret AND different audience. Either alone would be enough; both is the
  // point — a customer token must never open a staff route or vice versa.
  const jwt = (await import('jsonwebtoken')).default
  const forged = jwt.sign({ typ: 'staff_access', phone: PHONE }, process.env.JWT_STAFF_SECRET, {
    subject: PHONE,
    issuer: 'sugarloop',
    audience: 'sugarloop-staff',
  })

  assert.throws(() => service.verifyCustomerToken(forged))
})
