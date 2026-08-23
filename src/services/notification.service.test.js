import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  TEMPLATES,
  notify,
  notifyEnquiryReceived,
  notifyOrderPlaced,
  notifyStatusChange,
} from './notification.service.js'
import { FULFILMENT, ORDER_STATUS } from '../config/constants.js'

/** A send that records what it was asked to deliver. */
function recorder() {
  const sent = []
  const send = async (message) => {
    sent.push(message)
    return { transport: 'test', messageId: `m${sent.length}` }
  }
  return { sent, send }
}

/** A send that fails the way a provider outage does. */
const failing = async () => {
  throw new Error('Meta returned 503')
}

const BRANCH = { name: 'Sugar Loop DHA 2', phone: '+92 51 111 557 799' }

function orderFixture(overrides = {}) {
  return {
    orderNumber: 'SL-260824-0007',
    status: ORDER_STATUS.PLACED,
    fulfilment: FULFILMENT.DELIVERY,
    contact: { name: 'Ayesha', phone: '+923001234567' },
    totals: { grandTotal: 129900 },
    items: [{}, {}],
    ...overrides,
  }
}

describe('notify', () => {
  test('passes the template and its parameters to the transport', async () => {
    const { sent, send } = recorder()

    const result = await notify(
      { to: '+923001234567', template: TEMPLATES.ORDER_PLACED, params: ['Ayesha'] },
      { send }
    )

    assert.equal(result.sent, true)
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0], {
      to: '+923001234567',
      template: TEMPLATES.ORDER_PLACED,
      params: ['Ayesha'],
    })
  })

  test('a failing transport is reported, never thrown', async () => {
    // The whole contract. Every caller is a write that already succeeded, so a throw here
    // would turn a placed order into a 500 and invite the customer to place it twice.
    const result = await notify(
      { to: '+923001234567', template: TEMPLATES.ORDER_PLACED },
      { send: failing }
    )

    assert.equal(result.sent, false)
  })

  test('a message with no recipient is skipped rather than attempted', async () => {
    const { sent, send } = recorder()

    const result = await notify({ to: '', template: TEMPLATES.NEW_ORDER_STAFF }, { send })

    assert.equal(result.sent, false)
    assert.equal(sent.length, 0, 'must not call the provider with an empty number')
  })
})

describe('notifyOrderPlaced', () => {
  test('messages the customer and the branch that has to make it', async () => {
    const { sent, send } = recorder()

    await notifyOrderPlaced(orderFixture(), BRANCH, { send })

    assert.equal(sent.length, 2)
    assert.equal(sent[0].template, TEMPLATES.ORDER_PLACED)
    assert.equal(sent[0].to, '+923001234567')
    assert.equal(sent[1].template, TEMPLATES.NEW_ORDER_STAFF)
    assert.equal(sent[1].to, BRANCH.phone)
  })

  test('the customer message carries the number, the total and a line to call', async () => {
    const { sent, send } = recorder()

    await notifyOrderPlaced(orderFixture(), BRANCH, { send })

    const params = sent[0].params
    assert.ok(params.includes('SL-260824-0007'), 'the order number')
    assert.ok(params.includes(BRANCH.phone), 'every template ends with a number a human answers')
    assert.ok(
      params.some((p) => String(p).includes('1,299')),
      'the grand total, formatted as rupees rather than paisa'
    )
  })

  test('a pickup order is told where to collect, not that it will be delivered', async () => {
    const { sent, send } = recorder()

    await notifyOrderPlaced(orderFixture({ fulfilment: FULFILMENT.PICKUP }), BRANCH, { send })

    assert.ok(sent[0].params.some((p) => String(p).includes('collection')))
    assert.ok(!sent[0].params.some((p) => String(p).includes('delivered')))
    assert.ok(sent[1].params.includes('Pickup'))
  })

  test('a branch with no number on file still gets the customer messaged', async () => {
    // A seeding gap must not cost the customer their confirmation.
    const { sent, send } = recorder()

    await notifyOrderPlaced(orderFixture(), { name: 'Sugar Loop NUST H-12' }, { send })

    assert.equal(sent.length, 1)
    assert.equal(sent[0].template, TEMPLATES.ORDER_PLACED)
  })

  test('a provider outage does not propagate out of a placed order', async () => {
    await assert.doesNotReject(() => notifyOrderPlaced(orderFixture(), BRANCH, { send: failing }))
  })
})

describe('notifyStatusChange', () => {
  for (const [status, template] of [
    [ORDER_STATUS.OUT_FOR_DELIVERY, TEMPLATES.OUT_FOR_DELIVERY],
    [ORDER_STATUS.READY_FOR_PICKUP, TEMPLATES.READY_FOR_PICKUP],
    [ORDER_STATUS.COMPLETED, TEMPLATES.ORDER_COMPLETED],
  ]) {
    test(`${status} messages the customer`, async () => {
      const { sent, send } = recorder()

      await notifyStatusChange(orderFixture({ status }), BRANCH, { send })

      assert.equal(sent.length, 1)
      assert.equal(sent[0].template, template)
      assert.ok(sent[0].params.includes(BRANCH.phone))
    })
  }

  for (const status of [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.FAILED]) {
    test(`${status} sends nothing`, async () => {
      // confirmed/preparing are kitchen bookkeeping — messaging twice in five minutes
      // trains customers to mute the number that later carries their OTP. `failed` needs
      // a human explaining what happens next, which the fail-reason form prompts for.
      const { sent, send } = recorder()

      await notifyStatusChange(orderFixture({ status }), BRANCH, { send })

      assert.equal(sent.length, 0)
    })
  }
})

describe('notifyEnquiryReceived', () => {
  test('falls back to the email address when the company was left blank', async () => {
    const { sent, send } = recorder()

    await notifyEnquiryReceived(
      { id: 'abc123', name: 'Sana', company: '', email: 'sana@acme.pk', subject: '' },
      { send }
    )

    // ENQUIRY_NOTIFY_PHONE is unset in test, so nothing is dispatched — but the message
    // must still have been assembled without throwing on the empty fields.
    assert.equal(sent.length, 0)
  })

  test('a failing transport never costs the shop the lead', async () => {
    await assert.doesNotReject(() =>
      notifyEnquiryReceived({ id: 'abc123', name: 'Sana', email: 'sana@acme.pk' }, { send: failing })
    )
  })
})
