import test from 'node:test'
import assert from 'node:assert/strict'

import { Product } from '../models/Product.js'
import { productView, productListView } from './productView.js'

/** A document, not a literal — so the view is tested against what it really receives. */
const product = (overrides = {}) =>
  new Product({
    sku: 'DON-LOTUS',
    slug: 'lotus',
    name: 'Lotus',
    category: 'Donuts',
    type: 'Signature',
    price: 29_900,
    description: 'Biscoff spread.',
    legacyId: 2,
    boxEligible: true,
    sortOrder: 20,
    images: [
      { url: 'https://cdn/lotus1.webp', publicId: 'sugarloop/lotus1', alt: 'Lotus donut', order: 0 },
    ],
    ...overrides,
  })

test('emits the fields a storefront needs', () => {
  const view = productView(product())

  assert.equal(view.sku, 'DON-LOTUS')
  assert.equal(view.slug, 'lotus')
  assert.equal(view.name, 'Lotus')
  assert.equal(view.category, 'Donuts')
  assert.equal(view.price, 29_900, 'price stays integer paisa')
  assert.equal(view.priceFormatted, 'Rs 299')
  assert.equal(view.boxEligible, true)
  assert.equal(view.legacyId, 2)
  assert.equal(typeof view.id, 'string')
})

test('never leaks internals', async (t) => {
  const view = productView(product())

  await t.test('no Cloudinary publicId — it is the argument to a destroy call', () => {
    assert.equal(view.images[0].url, 'https://cdn/lotus1.webp')
    assert.equal(view.images[0].publicId, undefined)
    assert.ok(!JSON.stringify(view).includes('sugarloop/lotus1'))
  })

  await t.test('no dormant FBR fields', () => {
    // Publishing taxRatePercent: 0 invites a client to start doing tax arithmetic
    // against a field we are not ready to stand behind (design §9b).
    assert.equal(view.taxRatePercent, undefined)
    assert.equal(view.priceIncludesTax, undefined)
    assert.equal(view.pctCode, undefined)
  })

  await t.test('no internal bookkeeping', () => {
    for (const field of ['sortOrder', 'isActive', '_id', '__v', 'createdAt', 'updatedAt']) {
      assert.equal(view[field], undefined, `${field} should not be published`)
    }
  })
})

test('inStock is present only when a branch was named', async (t) => {
  await t.test('omitted entirely without a branch', () => {
    const view = productView(product())
    // Absent, not false: an absent field makes a frontend ask, a wrong value makes it lie.
    assert.equal('inStock' in view, false)
  })

  await t.test('included when known', () => {
    assert.equal(productView(product(), { inStock: true }).inStock, true)
    assert.equal(productView(product(), { inStock: false }).inStock, false)
  })
})

test('legacyId is omitted for products that never had one', () => {
  // Admin-created products carry no legacy id; publishing `null` would have the frontend
  // key a cart entry on it.
  const view = productView(product({ legacyId: undefined }))
  assert.equal('legacyId' in view, false)
})

test('productListView applies the stock lookup per product', () => {
  const donut = product()
  const coffee = product({ sku: 'DRK-LATTE', slug: 'latte', name: 'Latte', category: 'Drinks' })

  const soldOut = new Set([String(coffee._id)])
  const views = productListView([donut, coffee], (id) => !soldOut.has(String(id)))

  assert.equal(views.length, 2)
  assert.equal(views[0].inStock, true)
  assert.equal(views[1].inStock, false)
})

test('productListView omits stock when no branch was named', () => {
  const views = productListView([product()], null)
  assert.equal('inStock' in views[0], false)
})

test('missing optional fields degrade to sane values, not undefined', () => {
  const bare = productView(product({ images: undefined, allergens: undefined, description: '' }))

  assert.deepEqual(bare.images, [])
  assert.deepEqual(bare.allergens, [])
  assert.equal(bare.description, '')
})
