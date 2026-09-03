import test from 'node:test'
import assert from 'node:assert/strict'

import { env } from '../config/env.js'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  keyBelongsTo,
  keyFor,
  publicUrlFor,
} from './imageStorage.service.js'
import {
  attachImageSchema,
  imageUploadUrlSchema,
} from '../validators/staffProduct.validator.js'

/**
 * The parts of image storage that can be checked without a bucket.
 *
 * Everything here is either a security boundary or a rule two files have to agree on —
 * which is why it is worth a test that runs on every laptop rather than only where AWS
 * credentials exist. Signing and the S3 round trip are not covered; they need a real
 * bucket, and mocking the SDK would only assert that the mock was called.
 */

const PRODUCT = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd799439099'

test('object keys', async (t) => {
  await t.test('takes its extension from the content type, not the filename', () => {
    // A file named .png that is really a WebP is routine — browsers and phone galleries
    // rename freely. The bytes decide, because the extension is what a CDN and half the
    // image tooling downstream will believe.
    const key = keyFor(PRODUCT, 'photo.png', 'image/webp')
    assert.ok(key.endsWith('.webp'), key)
  })

  await t.test('slugs names that are legal in S3 and painful in a URL', () => {
    const key = keyFor(PRODUCT, 'Front Shot #2 (final).JPG', 'image/jpeg')
    // Spaces, # and parentheses all survive into an S3 key untouched, then break in
    // whichever client encodes them differently from the one that wrote them.
    assert.match(key, /^products\/507f1f77bcf86cd799439011\/[0-9a-f]{8}-front-shot-2-final\.jpg$/)
  })

  await t.test('falls back to a name rather than producing a bare extension', () => {
    // '###.jpg' slugs to the empty string; without the fallback the key would end in a
    // hyphen followed by the extension and read as corrupt.
    assert.match(keyFor(PRODUCT, '###.jpg', 'image/jpeg'), /\/[0-9a-f]{8}-image\.jpg$/)
  })

  await t.test('two uploads of the same filename do not collide', () => {
    // Without the random component the second export named front.jpg silently replaces
    // the first, and a product loses a photo it still has a row for.
    const a = keyFor(PRODUCT, 'front.jpg', 'image/jpeg')
    const b = keyFor(PRODUCT, 'front.jpg', 'image/jpeg')
    assert.notEqual(a, b)
  })

  await t.test('every key is filed under its own product', () => {
    assert.ok(keyFor(PRODUCT, 'a.jpg', 'image/jpeg').startsWith(`products/${PRODUCT}/`))
  })
})

test('key ownership is what stops one product touching another', async (t) => {
  // The client tells us which key it wrote. Without this check an admin could attach a
  // different product's photo and then delete it out from under them, since detaching an
  // image also deletes the object behind it.
  await t.test('accepts a key under this product', () => {
    assert.equal(keyBelongsTo(keyFor(PRODUCT, 'a.jpg', 'image/jpeg'), PRODUCT), true)
  })

  await t.test('rejects a key belonging to another product', () => {
    assert.equal(keyBelongsTo(keyFor(OTHER, 'a.jpg', 'image/jpeg'), PRODUCT), false)
  })

  await t.test('rejects traversal back out of the prefix', () => {
    assert.equal(keyBelongsTo(`products/${PRODUCT}/../${OTHER}/a.jpg`, PRODUCT), false)
  })

  await t.test('rejects a prefix that merely starts the same way', () => {
    // `products/<id>x/...` starts with `products/<id>` as a string but is a different
    // product. The trailing slash in the prefix is the whole defence.
    assert.equal(keyBelongsTo(`products/${PRODUCT}x/a.jpg`, PRODUCT), false)
  })

  await t.test('rejects a non-string', () => {
    assert.equal(keyBelongsTo(undefined, PRODUCT), false)
    assert.equal(keyBelongsTo(null, PRODUCT), false)
  })
})

test('public URLs', async (t) => {
  const original = env.ASSET_BASE_URL
  t.after(() => {
    env.ASSET_BASE_URL = original
  })

  await t.test('prefers the CDN domain when one is configured', () => {
    env.ASSET_BASE_URL = 'https://d111111abcdef8.cloudfront.net'
    assert.equal(
      publicUrlFor('products/1/a.webp'),
      'https://d111111abcdef8.cloudfront.net/products/1/a.webp'
    )
  })

  await t.test('falls back to the bucket endpoint', () => {
    env.ASSET_BASE_URL = undefined
    assert.equal(
      publicUrlFor('products/1/a.webp'),
      `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/products/1/a.webp`
    )
  })
})

test('what an upload is allowed to be', async (t) => {
  const VALID = { filename: 'front.webp', contentType: 'image/webp', size: 204_800 }

  await t.test('accepts the four image types the storefront serves', () => {
    for (const contentType of Object.keys(ALLOWED_IMAGE_TYPES)) {
      assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, contentType }).success, true, contentType)
    }
  })

  await t.test('rejects SVG', () => {
    // Not a formatting preference. An SVG is XML that may carry <script>, and these
    // files are served from the domain the storefront trusts — so accepting one is
    // stored XSS against every visitor.
    assert.equal(
      imageUploadUrlSchema.safeParse({ ...VALID, contentType: 'image/svg+xml' }).success,
      false
    )
  })

  await t.test('rejects anything that is not an image at all', () => {
    for (const contentType of ['text/html', 'application/pdf', 'video/mp4', 'application/json']) {
      assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, contentType }).success, false, contentType)
    }
  })

  await t.test('requires a declared size, and holds it to the limit', () => {
    // The size is signed into the upload URL, so this is what stops a URL issued for a
    // 200 KB photo being spent on a 2 GB file.
    assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, size: undefined }).success, false)
    assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, size: 0 }).success, false)
    assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, size: -1 }).success, false)
    assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, size: 1.5 }).success, false)
    assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, size: MAX_IMAGE_BYTES }).success, true)
    assert.equal(imageUploadUrlSchema.safeParse({ ...VALID, size: MAX_IMAGE_BYTES + 1 }).success, false)
  })

  await t.test('alt text is optional', () => {
    // Requiring it would mean writing accessibility copy before the upload is allowed to
    // finish. The service falls back to the product name, which is what anyone would type.
    assert.equal(attachImageSchema.parse({ key: 'products/1/a.webp' }).alt, '')
  })
})
