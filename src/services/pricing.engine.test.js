import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { priceCart, taxBreakdown } from './pricing.engine.js'
import { Product } from '../models/Product.js'
import { Branch } from '../models/Branch.js'

/**
 * No database. The engine takes products and stock a caller has already loaded, which is
 * what lets the money arithmetic be exercised at every edge in milliseconds.
 */

const product = (overrides) =>
  new Product({
    sku: 'DON-LOTUS',
    slug: 'lotus',
    name: 'Lotus',
    category: 'Donuts',
    price: 29_900,
    boxEligible: true,
    ...overrides,
  })

const CATALOGUE = [
  product(),
  product({ sku: 'DON-KITKAT-CRUNCH', slug: 'kitkat-crunch', name: 'KitKat Crunch', price: 42_900 }),
  product({ sku: 'DON-CLASSIC-OREO', slug: 'classic-oreo', name: 'Classic Oreo', price: 18_500 }),
  product({
    sku: 'DRK-LATTE',
    slug: 'latte',
    name: 'Latte',
    category: 'Drinks',
    price: 49_900,
    boxEligible: false,
  }),
]

const byName = (name) => CATALOGUE.find((p) => p.name === name)
const productsById = new Map(CATALOGUE.map((p) => [String(p._id), p]))
const idOf = (name) => String(byName(name)._id)

const branch = (overrides = {}) =>
  new Branch({
    name: 'Sugar Loop DHA 2',
    code: 'DHA2',
    address: 'Nadir Arcade',
    city: 'Islamabad',
    phone: '+92 51 111 557 799',
    location: { type: 'Point', coordinates: [73.1574172, 33.5312498] },
    hours: { open: '11:00', close: '03:00' },
    lastOrderBufferMinutes: 30,
    ...overrides,
  })

/** Mid-service, comfortably inside the ordering window. */
const OPEN = new Date('2026-08-10T14:00:00+05:00')

const allInStock = () => true

const price = (items, options = {}) =>
  priceCart({
    items,
    fulfilment: 'delivery',
    branch: branch(),
    productsById,
    isInStock: allInStock,
    now: OPEN,
    ...options,
  })

const line = (name, qty = 1) => ({ kind: 'product', productId: idOf(name), qty })

// ─────────────────────────────────────────────────────────────────────────────
// The rule the whole engine exists for
// ─────────────────────────────────────────────────────────────────────────────

test('a price posted by the client is ignored entirely', () => {
  const honest = price([line('KitKat Crunch', 2)])

  // Same cart, but the client claims each donut costs Rs 0.01 and the total is Rs 0.02.
  const hostile = price([
    { kind: 'product', productId: idOf('KitKat Crunch'), qty: 2, price: 1, lineTotal: 2, total: 2 },
  ])

  assert.equal(hostile.items[0].unitPrice, 42_900, 'unit price comes from the database')
  assert.equal(hostile.items[0].lineTotal, 85_800)
  assert.equal(hostile.totals.grandTotal, honest.totals.grandTotal)
  assert.deepEqual(hostile.totals, honest.totals)
})

// ─────────────────────────────────────────────────────────────────────────────
// Totals
// ─────────────────────────────────────────────────────────────────────────────

test('subtotal is the sum of unit price x quantity', () => {
  const quote = price([line('Lotus', 2), line('Latte', 1)])

  assert.equal(quote.items[0].lineTotal, 59_800)
  assert.equal(quote.items[1].lineTotal, 49_900)
  assert.equal(quote.totals.subtotal, 109_700)
})

test('delivery adds Rs 100, pickup adds nothing', async (t) => {
  const items = [line('KitKat Crunch', 2)]

  await t.test('delivery', () => {
    const quote = price(items)
    assert.equal(quote.totals.deliveryFee, 10_000)
    assert.equal(quote.totals.grandTotal, 85_800 + 10_000)
  })

  await t.test('pickup', () => {
    const quote = price(items, { fulfilment: 'pickup' })
    assert.equal(quote.totals.deliveryFee, 0)
    assert.equal(quote.totals.grandTotal, 85_800)
  })
})

test('a Rs 400 cart is rejected with the exact shortfall', () => {
  // Rs 185 + Rs 185 = Rs 370, under the Rs 500 minimum.
  assert.throws(
    () => price([line('Classic Oreo', 2)]),
    (err) => {
      assert.equal(err.statusCode, 409)
      assert.equal(err.code, 'MINIMUM_ORDER_NOT_MET')
      assert.equal(err.details.subtotal, 37_000)
      assert.equal(err.details.minimumOrderValue, 50_000)
      assert.equal(err.details.shortfall, 13_000, 'Rs 130 more needed')
      return true
    }
  )
})

test('the minimum is judged on the subtotal, not the delivery fee', () => {
  // Rs 370 + Rs 100 delivery would clear Rs 500 — charging someone to qualify for the
  // spend they were told to reach is not the deal.
  assert.throws(() => price([line('Classic Oreo', 2)]), /Minimum order/)

  // Rs 499 is still short by one rupee.
  const almost = [line('Latte', 1)]
  assert.throws(() => price(almost), (err) => err.details.shortfall === 100)
})

// ─────────────────────────────────────────────────────────────────────────────
// Build Your Box
// ─────────────────────────────────────────────────────────────────────────────

test('a 4-box of Crafted prices to Rs 1,716', () => {
  const kitkat = idOf('KitKat Crunch')
  const quote = price([{ kind: 'box', boxSize: 4, productIds: [kitkat, kitkat, kitkat, kitkat] }])

  assert.equal(quote.items[0].lineTotal, 171_600)
  assert.equal(quote.totals.subtotal, 171_600)
  assert.equal(quote.items[0].children.length, 4, 'contents itemised for reorder')
})

test('a box costs exactly the sum of its contents — no packaging charge, no discount', () => {
  const box = price([
    { kind: 'box', boxSize: 2, productIds: [idOf('Lotus'), idOf('KitKat Crunch')] },
  ])
  const loose = price([line('Lotus'), line('KitKat Crunch')])

  assert.equal(box.totals.subtotal, loose.totals.subtotal)
  assert.equal(box.totals.subtotal, 29_900 + 42_900)
})

test('duplicates in a box are allowed and are counted', () => {
  const lotus = idOf('Lotus')
  const quote = price([{ kind: 'box', boxSize: 2, productIds: [lotus, lotus] }])

  assert.equal(quote.items[0].lineTotal, 59_800)
  assert.equal(quote.items[0].children.length, 2)
})

test('categories may mix inside a box', () => {
  // The current frontend forbids donuts + croissants together; that rule is being
  // removed, so the server must not re-impose it.
  const quote = price([
    {
      kind: 'box',
      boxSize: 4,
      productIds: [idOf('Lotus'), idOf('KitKat Crunch'), idOf('Classic Oreo'), idOf('Lotus')],
    },
  ])

  assert.equal(quote.items[0].lineTotal, 29_900 + 42_900 + 18_500 + 29_900)
})

test('a box must hold exactly N items', async (t) => {
  const lotus = idOf('Lotus')

  await t.test('too few', () => {
    assert.throws(
      () => price([{ kind: 'box', boxSize: 4, productIds: [lotus, lotus] }]),
      (err) => err.statusCode === 422 && err.code === 'INVALID_BOX' && err.details.received === 2
    )
  })

  await t.test('too many', () => {
    assert.throws(
      () => price([{ kind: 'box', boxSize: 2, productIds: [lotus, lotus, lotus] }]),
      (err) => err.code === 'INVALID_BOX' && err.details.received === 3
    )
  })

  await t.test('a size nobody sells', () => {
    assert.throws(
      () => price([{ kind: 'box', boxSize: 5, productIds: Array(5).fill(lotus) }]),
      (err) => err.code === 'INVALID_BOX' && err.details.boxSize === 5
    )
  })
})

test('ineligible items cannot go in a box, and are named', () => {
  assert.throws(
    () => price([{ kind: 'box', boxSize: 2, productIds: [idOf('Lotus'), idOf('Latte')] }]),
    (err) => {
      assert.equal(err.code, 'ITEMS_UNAVAILABLE')
      assert.deepEqual(err.details.notBoxEligible, ['Latte'])
      return true
    }
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Stock and availability
// ─────────────────────────────────────────────────────────────────────────────

test('a sold-out item is rejected BY NAME, with the branch', () => {
  const soldOut = idOf('Lotus')

  assert.throws(
    () => price([line('Lotus', 2), line('Latte', 1)], { isInStock: (id) => String(id) !== soldOut }),
    (err) => {
      assert.equal(err.statusCode, 409)
      assert.equal(err.code, 'ITEMS_UNAVAILABLE')
      assert.deepEqual(err.details.outOfStock, ['Lotus'])
      assert.equal(err.details.branchCode, 'DHA2')
      // The UI needs to say "Lotus is sold out at Sugar Loop DHA 2", not show an id.
      assert.match(err.message, /Lotus sold out at Sugar Loop DHA 2/)
      return true
    }
  )
})

test('every problem is reported at once, not one per round trip', () => {
  const missing = String(new mongoose.Types.ObjectId())

  assert.throws(
    () =>
      price([line('Lotus'), { kind: 'product', productId: missing, qty: 1 }, line('Latte')], {
        isInStock: (id) => String(id) !== idOf('Latte'),
      }),
    (err) => {
      assert.deepEqual(err.details.outOfStock, ['Latte'])
      assert.deepEqual(err.details.unavailable, [missing])
      return true
    }
  )
})

test('a sold-out item inside a box fails the box', () => {
  const lotus = idOf('Lotus')

  assert.throws(
    () =>
      price([{ kind: 'box', boxSize: 2, productIds: [lotus, idOf('KitKat Crunch')] }], {
        isInStock: (id) => String(id) !== lotus,
      }),
    (err) => err.code === 'ITEMS_UNAVAILABLE' && err.details.outOfStock.includes('Lotus')
  )
})

test('a product not in the loaded catalogue is unavailable, not priced at zero', () => {
  const ghost = String(new mongoose.Types.ObjectId())

  assert.throws(
    () => price([{ kind: 'product', productId: ghost, qty: 1 }]),
    (err) => err.code === 'ITEMS_UNAVAILABLE' && err.details.unavailable.includes(ghost)
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Opening hours
// ─────────────────────────────────────────────────────────────────────────────

test('the ordering window is enforced server-side', async (t) => {
  const items = [line('KitKat Crunch', 2)]
  const at = (hhmm) => new Date(`2026-08-10T${hhmm}:00+05:00`)

  await t.test('02:29 — accepted', () => {
    assert.equal(price(items, { now: at('02:29') }).totals.grandTotal, 95_800)
  })

  await t.test('02:31 — past the cutoff, refused with the next opening time', () => {
    assert.throws(
      () => price(items, { now: at('02:31') }),
      (err) => {
        assert.equal(err.statusCode, 409)
        assert.equal(err.code, 'BRANCH_NOT_ACCEPTING_ORDERS')
        assert.equal(err.details.isOpenNow, true, 'still trading, just not taking orders')
        assert.equal(err.details.opensAt.toISOString(), at('11:00').toISOString())
        return true
      }
    )
  })

  await t.test('09:00 — shut', () => {
    assert.throws(
      () => price(items, { now: at('09:00') }),
      (err) => err.code === 'BRANCH_NOT_ACCEPTING_ORDERS' && err.details.isOpenNow === false
    )
  })
})

test('a manager pause blocks checkout even mid-service', () => {
  assert.throws(
    () => price([line('KitKat Crunch', 2)], { branch: branch({ acceptingOrders: false }) }),
    (err) => err.code === 'BRANCH_NOT_ACCEPTING_ORDERS'
  )
})

test('a branch that does not offer the fulfilment mode refuses it', () => {
  assert.throws(
    () =>
      price([line('KitKat Crunch', 2)], {
        branch: branch({ fulfilment: ['pickup'] }),
        fulfilment: 'delivery',
      }),
    (err) => err.statusCode === 409 && err.code === 'FULFILMENT_UNAVAILABLE'
  )
})

test('closed is checked before the cart, so a 3am typo does not leak the menu', () => {
  // An unorderable cart at a closed branch reports the closure, not the cart contents.
  assert.throws(
    () => price([line('Classic Oreo', 1)], { now: new Date('2026-08-10T09:00:00+05:00') }),
    (err) => err.code === 'BRANCH_NOT_ACCEPTING_ORDERS'
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Tax — 0% today, but the shape has to be right (design §9b)
// ─────────────────────────────────────────────────────────────────────────────

test('every line carries a tax breakdown at 0%', () => {
  const quote = price([line('KitKat Crunch', 2)])
  const [only] = quote.items

  assert.equal(only.netAmount, 85_800)
  assert.equal(only.taxRate, 0)
  assert.equal(only.taxAmount, 0)
  assert.equal(only.grossAmount, 85_800)
  assert.equal(quote.totals.tax, 0)
})

test('taxBreakdown reconciles exactly at any rate', async (t) => {
  await t.test('0% — net equals gross', () => {
    assert.deepEqual(taxBreakdown(29_900), {
      netAmount: 29_900,
      taxRate: 0,
      taxAmount: 0,
      grossAmount: 29_900,
    })
  })

  await t.test('18% inclusive — the shelf price is unchanged, margin absorbs it', () => {
    const b = taxBreakdown(29_900, 18, true)
    assert.equal(b.grossAmount, 29_900)
    assert.equal(b.netAmount + b.taxAmount, b.grossAmount, 'components sum to the total')
  })

  await t.test('18% exclusive — tax is added on top', () => {
    const b = taxBreakdown(29_900, 18, false)
    assert.equal(b.netAmount, 29_900)
    assert.equal(b.netAmount + b.taxAmount, b.grossAmount)
    assert.equal(b.grossAmount, 35_282)
  })

  await t.test('never drifts by a hundredth of a rupee across awkward amounts', () => {
    for (const amount of [1, 7, 33, 199, 18_500, 29_900, 42_900, 171_600, 999_999]) {
      for (const rate of [0, 5, 17, 18]) {
        for (const inclusive of [true, false]) {
          const b = taxBreakdown(amount, rate, inclusive)
          assert.equal(
            b.netAmount + b.taxAmount,
            b.grossAmount,
            `${amount} at ${rate}% ${inclusive ? 'inclusive' : 'exclusive'}`
          )
          assert.ok(Number.isInteger(b.taxAmount), 'tax stays a whole stored amount')
        }
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Shape of the result
// ─────────────────────────────────────────────────────────────────────────────

test('the quote carries what an order will need', () => {
  const quote = price([line('KitKat Crunch', 2)])

  assert.equal(quote.currency, 'PKR')
  assert.equal(quote.fulfilment, 'delivery')
  assert.equal(quote.branch.code, 'DHA2')
  // Name, sku and unit price are snapshotted onto the line — a later price change must
  // never rewrite what an order said it cost.
  assert.equal(quote.items[0].sku, 'DON-KITKAT-CRUNCH')
  assert.equal(quote.items[0].name, 'KitKat Crunch')
  // promisedAt is 45 minutes out: cook plus travel.
  assert.equal(quote.promisedAt.getTime() - OPEN.getTime(), 45 * 60_000)
})

test('totals always reconcile against the lines', () => {
  const quote = price([
    line('Lotus', 3),
    line('Latte', 2),
    { kind: 'box', boxSize: 2, productIds: [idOf('KitKat Crunch'), idOf('Classic Oreo')] },
  ])

  const fromLines = quote.items.reduce((total, item) => total + item.lineTotal, 0)

  assert.equal(quote.totals.subtotal, fromLines)
  assert.equal(
    quote.totals.grandTotal,
    quote.totals.subtotal + quote.totals.deliveryFee - quote.totals.discount
  )
  assert.ok(Number.isInteger(quote.totals.grandTotal), 'still a whole stored amount')
})
