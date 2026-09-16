import test from 'node:test'
import assert from 'node:assert/strict'

import { createOrderSchema } from './order.validator.js'

const order = (contact) => ({
  fulfilment: 'pickup',
  branchCode: 'DHA2',
  contact: { name: 'Ayesha Khan', email: 'ayesha.khan@example.com', ...contact },
  items: [{ kind: 'product', productId: '507f1f77bcf86cd799439011', qty: 2 }],
  expectedTotal: 85_800,
})

test('an order without a contact number is refused', () => {
  const result = createOrderSchema.safeParse(order({}))

  assert.equal(result.success, false)
  assert.ok(result.error.issues.some((issue) => issue.path.join('.') === 'contact.phone'))
})

test('a contact number is stored in one canonical form, however it was typed', () => {
  for (const typed of ['03001234567', '+92 300 1234567', '0300-1234567']) {
    const result = createOrderSchema.safeParse(order({ phone: typed }))

    assert.equal(result.success, true, typed)
    assert.equal(result.data.contact.phone, '+923001234567')
  }
})

test('a number that is not a Pakistani mobile is refused', () => {
  const result = createOrderSchema.safeParse(order({ phone: '0512345678' }))

  assert.equal(result.success, false)
})
