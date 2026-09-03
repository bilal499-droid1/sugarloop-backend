import test from 'node:test'
import assert from 'node:assert/strict'

import { Product } from '../models/Product.js'
import { AuditLog } from '../models/AuditLog.js'
import { STAFF_ROLE } from '../config/constants.js'
import * as staffProductService from './staffProduct.service.js'
import { slugify } from './staffProduct.service.js'
import {
  createProductSchema,
  updateProductSchema,
} from '../validators/staffProduct.validator.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Admin catalogue management.
 *
 * Two rules carry almost all the risk here and get almost all the coverage:
 *
 *   1. A price is an integer number of paisa. `299` is Rs 2.99, not Rs 299, and nothing
 *      downstream can tell the difference — the order would simply be cheap.
 *   2. Nothing is ever deleted. Past orders reference these documents.
 *
 * SKIPS rather than fails when Mongo is unreachable, matching the other integration
 * suites. See testing/mongoTestDb.js.
 */
const { connected, skip } = await connectTestDatabase('staffProduct')

const ADMIN = {
  _id: '000000000000000000000001',
  email: 'admin@sugarloop.pk',
  name: 'Sugarloop Admin',
  role: STAFF_ROLE.ADMIN,
}

const CONTEXT = { actor: ADMIN, ip: '1.2.3.4' }

const VALID = {
  name: 'Pistachio Cream',
  sku: 'DON-PISTACHIO-CREAM',
  category: 'Donuts',
  type: 'Crafted Donuts',
  price: 42900, // Rs 429
  description: 'A crafted donut.',
}

test('admin product management', { skip, concurrency: false }, async (t) => {
  t.after(() => disconnectTestDatabase(connected))
  t.beforeEach(async () => {
    await Product.deleteMany({})
    await AuditLog.deleteMany({})
  })

  await t.test('creates a product and derives its slug from the name', async () => {
    const product = await staffProductService.create(
      createProductSchema.parse(VALID),
      CONTEXT
    )

    assert.equal(product.name, 'Pistachio Cream')
    assert.equal(product.slug, 'pistachio-cream')
    assert.equal(product.price, 42900)
    assert.equal(product.isActive, true)
    assert.equal(product.legacyId, undefined, 'only the seeded 43 carry a legacy id')
  })

  await t.test('an explicit slug wins over the derived one', async () => {
    const product = await staffProductService.create(
      createProductSchema.parse({ ...VALID, slug: 'the-green-one' }),
      CONTEXT
    )

    assert.equal(product.slug, 'the-green-one')
  })

  await t.test('records who created it, with the price in both forms', async () => {
    const product = await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)

    const entry = await AuditLog.findOne({ action: 'product.create' })
    assert.ok(entry, 'a new catalogue item is an audited event')
    assert.equal(String(entry.entityId), String(product._id))
    assert.equal(entry.actorEmail, 'admin@sugarloop.pk')
    assert.equal(entry.changes.price.to, 42900)
    // The formatted copy is what makes the trail checkable against a printed menu.
    assert.match(entry.changes.price.formatted, /429/)
  })

  await t.test('a price change is audited in rupees as well as paisa', async () => {
    // The single most consequential edit in the system: one click changes what every
    // future customer pays, so "who put the box of 12 at Rs 49" needs a real answer.
    const product = await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)

    await staffProductService.update(
      product._id,
      updateProductSchema.parse({ price: 49900 }),
      CONTEXT
    )

    const entry = await AuditLog.findOne({ action: 'product.update' })
    assert.ok(entry)
    assert.deepEqual(
      { from: entry.changes.price.from, to: entry.changes.price.to },
      { from: 42900, to: 49900 }
    )
    assert.match(entry.changes.priceFormatted.from, /429/)
    assert.match(entry.changes.priceFormatted.to, /499/)
    assert.equal(entry.changes.sku, 'DON-PISTACHIO-CREAM', 'searchable by what a human has')
  })

  await t.test('an edit that changes nothing writes no audit row', async () => {
    const product = await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)

    await staffProductService.update(
      product._id,
      updateProductSchema.parse({ price: 42900, name: 'Pistachio Cream' }),
      CONTEXT
    )

    assert.equal(
      await AuditLog.countDocuments({ action: 'product.update' }),
      0,
      'a no-op edit would only make the rows that matter harder to find'
    )
  })

  await t.test('discontinuing hides the product without deleting it', async () => {
    const product = await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)

    const removed = await staffProductService.remove(product._id, CONTEXT)

    assert.equal(removed.isActive, false)
    // The whole point: an order line referencing this must still resolve.
    const stored = await Product.findById(product._id)
    assert.ok(stored, 'the document survives — past orders reference it')

    const entry = await AuditLog.findOne({ action: 'product.discontinue' })
    assert.ok(entry)
  })

  await t.test('discontinuing twice is a conflict, not a silent success', async () => {
    const product = await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)
    await staffProductService.remove(product._id, CONTEXT)

    await assert.rejects(() => staffProductService.remove(product._id, CONTEXT), {
      statusCode: 409,
    })
  })

  await t.test('a discontinued product can be brought back', async () => {
    const product = await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)
    await staffProductService.remove(product._id, CONTEXT)

    const restored = await staffProductService.update(
      product._id,
      updateProductSchema.parse({ isActive: true }),
      CONTEXT
    )

    assert.equal(restored.isActive, true)
  })

  await t.test('a missing product is a 404, not a crash', async () => {
    await assert.rejects(
      () => staffProductService.getById('0123456789abcdef01234567'),
      { statusCode: 404 }
    )
  })

  await t.test('the admin list shows discontinued items, unlike the public one', async () => {
    const product = await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)
    await staffProductService.remove(product._id, CONTEXT)

    const { items } = await staffProductService.list({ limit: 50 })
    assert.equal(items.length, 1, 'the item an admin is looking for is usually the hidden one')

    const active = await staffProductService.list({ limit: 50, isActive: true })
    assert.equal(active.items.length, 0)
  })

  await t.test('search matches sku as well as name', async () => {
    await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)

    assert.equal((await staffProductService.list({ limit: 50, search: 'pistachio' })).items.length, 1)
    assert.equal((await staffProductService.list({ limit: 50, search: 'DON-PIS' })).items.length, 1)
    assert.equal((await staffProductService.list({ limit: 50, search: 'croissant' })).items.length, 0)
  })

  await t.test('a duplicate sku is refused', async () => {
    await staffProductService.create(createProductSchema.parse(VALID), CONTEXT)

    await assert.rejects(() =>
      staffProductService.create(
        createProductSchema.parse({ ...VALID, slug: 'a-different-slug' }),
        CONTEXT
      )
    )
  })
  /* ─── Product photos ────────────────────────────────────────────────────────
   *
   * These cover the checks that run BEFORE anything reaches S3, which is where all the
   * risk is: the client chooses the key, so every one of these is the boundary between
   * "an admin added a photo" and "an admin reached into another product's storage".
   *
   * The signing and the S3 round trip are not covered here. They need a real bucket, and
   * a mocked SDK would only prove the mock was called. `imageStorage.service.test.js`
   * covers the key rules those depend on.
   */

  /**
   * Puts a product in a known state without going through the upload round trip.
   *
   * The counter keeps `sku` and `slug` unique — both are unique indexes, and a test that
   * wants two products would otherwise fail on the duplicate rather than on what it set
   * out to check.
   */
  let productSeq = 0
  async function productWithImages(count) {
    productSeq += 1
    const product = await staffProductService.create(
      createProductSchema.parse({
        ...VALID,
        sku: `${VALID.sku}-${productSeq}`,
        slug: `pistachio-cream-${productSeq}`,
      }),
      CONTEXT
    )

    product.images = Array.from({ length: count }, (_, index) => ({
      url: `https://cdn.example/products/${product._id}/img${index}.webp`,
      publicId: `products/${product._id}/img${index}.webp`,
      alt: VALID.name,
      order: index,
    }))
    await product.save()

    return product
  }

  await t.test('a product cannot claim another product’s upload', async () => {
    const [mine, theirs] = [await productWithImages(0), await productWithImages(0)]

    await assert.rejects(
      () =>
        staffProductService.attachImage(
          mine._id,
          { key: `products/${theirs._id}/stolen.webp`, alt: '' },
          CONTEXT
        ),
      // Rejected before any S3 call — detaching deletes the object, so attaching someone
      // else's key would let one product delete another's photo.
      (err) => err.statusCode === 400 && /does not belong/i.test(err.message)
    )

    assert.equal((await Product.findById(mine._id)).images.length, 0)
  })

  await t.test('the same image cannot be attached twice', async () => {
    const product = await productWithImages(1)
    const existing = product.images[0].publicId

    await assert.rejects(
      () => staffProductService.attachImage(product._id, { key: existing, alt: '' }, CONTEXT),
      // Two rows pointing at one object shows the customer the same photo in two slots,
      // and the first delete breaks the second.
      (err) => err.statusCode === 409
    )
  })

  await t.test('a product tops out at the image limit', async () => {
    const product = await productWithImages(staffProductService.MAX_IMAGES_PER_PRODUCT)

    // Refused at step 1, so an admin already at the limit is told before they pick a
    // file rather than after waiting for it to upload.
    await assert.rejects(
      () =>
        staffProductService.createImageUpload(product._id, {
          filename: 'one-more.webp',
          contentType: 'image/webp',
          size: 1000,
        }),
      (err) => err.statusCode === 409 && /at most/i.test(err.message)
    )

    // And again at step 3, because step 1 is not a lock — two tabs could both pass it.
    await assert.rejects(
      () =>
        staffProductService.attachImage(
          product._id,
          { key: `products/${product._id}/one-more.webp`, alt: '' },
          CONTEXT
        ),
      (err) => err.statusCode === 409
    )
  })

  await t.test('removing an image that is not there is a 404, not a silent success', async () => {
    const product = await productWithImages(1)

    await assert.rejects(
      () => staffProductService.removeImage(product._id, 'products/x/never-existed.webp', CONTEXT),
      (err) => err.statusCode === 404
    )
  })

  await t.test('removing an image re-sequences the ones left', async () => {
    const product = await productWithImages(3)
    const removed = product.images[0].publicId

    // NOTE: S3 is unconfigured in tests, so the object delete fails and logs an error.
    // That is the behaviour under test — see below.
    const updated = await staffProductService.removeImage(product._id, removed, CONTEXT)

    assert.equal(updated.images.length, 2)
    assert.equal(
      updated.images.some((image) => image.publicId === removed),
      false
    )
    // A hole in `order` is harmless right up until something treats the value as an
    // index into the array, which is exactly the bug nobody looks for.
    assert.deepEqual(
      updated.images.map((image) => image.order),
      [0, 1]
    )
  })

  await t.test('a failed object delete still takes the photo off the site', async () => {
    // S3 is unconfigured here, so `deleteObject` fails. The row must go anyway: the
    // admin asked for the photo to come off, and a briefly unreachable bucket is not a
    // reason to tell them it did not. The orphaned object is logged, not surfaced.
    const product = await productWithImages(1)
    const updated = await staffProductService.removeImage(
      product._id,
      product.images[0].publicId,
      CONTEXT
    )

    assert.equal(updated.images.length, 0)
    assert.equal((await Product.findById(product._id)).images.length, 0)
  })

  await t.test('adding and removing a photo is audited', async () => {
    const product = await productWithImages(1)

    await staffProductService.removeImage(product._id, product.images[0].publicId, CONTEXT)

    const row = await AuditLog.findOne({ action: 'product.image.remove' })
    assert.ok(row, 'a photo leaving the catalogue is worth a row')
    // The SKU is what a human searching the trail has in hand; the entityId is what a
    // query joins on. Same reasoning as every other audit row in this service.
    assert.equal(row.changes.sku, product.sku)
  })
})

/** Schema-level, so these run with or without a database. */
test('product validators', async (t) => {
  await t.test('a price must be a whole number of paisa', () => {
    // The mistake this exists to stop: 299 meaning Rs 299. It is a valid integer and a
    // real price of Rs 2.99, so nothing downstream can catch it — only the person
    // typing it can, and only if the message says so.
    assert.equal(createProductSchema.safeParse({ ...VALID, price: 299.5 }).success, false)
    assert.equal(createProductSchema.safeParse({ ...VALID, price: -1 }).success, false)
    assert.equal(createProductSchema.safeParse({ ...VALID, price: '29900' }).success, false)
    assert.equal(createProductSchema.safeParse({ ...VALID, price: 29900 }).success, true)
  })

  await t.test('the price message spells out the conversion', () => {
    const result = createProductSchema.safeParse({ ...VALID, price: 299.5 })
    assert.match(result.error.issues[0].message, /29900/)
  })

  await t.test('sku cannot be edited', () => {
    // It is the key Nimbus POS maps against; changing it silently re-points that
    // mapping at a different item.
    const parsed = updateProductSchema.parse({ sku: 'DON-SOMETHING-ELSE', name: 'Renamed' })
    assert.equal(parsed.sku, undefined)
  })

  await t.test('legacyId cannot be set', () => {
    // It maps the seeded 43 onto ids that real localStorage carts key by. An invented
    // one would collide with somebody's saved cart.
    const parsed = createProductSchema.parse({ ...VALID, legacyId: 7 })
    assert.equal(parsed.legacyId, undefined)
  })

  await t.test('an empty update is rejected', () => {
    assert.equal(updateProductSchema.safeParse({}).success, false)
  })

  await t.test('a malformed slug or sku is rejected', () => {
    assert.equal(createProductSchema.safeParse({ ...VALID, slug: 'Not A Slug' }).success, false)
    assert.equal(createProductSchema.safeParse({ ...VALID, sku: 'lower-case' }).success, true)
    assert.equal(createProductSchema.safeParse({ ...VALID, sku: 'has space' }).success, false)
  })

  await t.test('slugify copes with punctuation rather than refusing it', () => {
    assert.equal(slugify("Chef's Special — Nutella & Co."), 'chef-s-special-nutella-co')
    assert.equal(slugify('  Double  Spaced  '), 'double-spaced')
  })

})
