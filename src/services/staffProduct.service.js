/**
 * Admin product management.
 *
 * The catalogue was seed-only until now: changing a price meant editing `itemData.js`
 * and re-running the seed, which is a developer and a deploy for something the shop
 * should be able to do on a Tuesday afternoon.
 *
 * Two rules shape everything here.
 *
 * **Nothing is ever deleted.** `remove` deactivates. Every order line stores a snapshot
 * of what was bought, but it also references the product, and an order whose lines
 * cannot resolve a product is one nobody can reprint, refund or argue about. A
 * discontinued item disappears from the site — which is what "delete" actually means to
 * the person clicking it — while staying resolvable forever.
 *
 * **Every price change is audited.** This is the only screen in the system where one
 * click changes what every future customer is charged, and "who put the box of 12 at
 * Rs 49" needs an answer that is not a guess. `audit.service` never throws, so a failed
 * audit write cannot roll back a legitimate edit — it logs loudly instead.
 *
 * Admin-only, enforced at the router. A branch manager's only write anywhere in the
 * catalogue is the per-branch stock toggle, and that is deliberate: one global price
 * list is the rule the pricing engine is built on.
 */
import { Product } from '../models/Product.js'
import { ApiError } from '../utils/ApiError.js'
import { formatPKR } from '../utils/money.js'
import * as audit from './audit.service.js'
import * as imageStorage from './imageStorage.service.js'

/** User input reaches a regex here, so metacharacters have to stop being metacharacters. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * "Chocoholic Deluxe" → "chocoholic-deluxe".
 *
 * Only used when an admin does not supply a slug. Strips anything that is not a letter,
 * a digit or a separator, so a name with an ampersand or an apostrophe still produces a
 * URL rather than a validation error thrown back at someone who never asked to think
 * about URLs.
 */
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function findOrThrow(id) {
  const product = await Product.findById(id)
  if (!product) throw ApiError.notFound('Product not found')
  return product
}

/**
 * The admin catalogue list.
 *
 * Shows discontinued items by default, which is the opposite of the public endpoint and
 * the right default here: an admin looking for a product they cannot find on the site is
 * usually looking for exactly the one that was switched off.
 */
export async function list({ category, boxEligible, isActive, search, limit, cursor }) {
  const filter = {}
  if (category) filter.category = category
  if (boxEligible !== undefined) filter.boxEligible = boxEligible
  if (isActive !== undefined) filter.isActive = isActive

  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i')
    filter.$or = [{ name: pattern }, { sku: pattern }, { slug: pattern }]
  }

  // Cursor pagination on _id, matching the order board, the team list and the enquiry
  // inbox. The catalogue is small enough today to fit one page, but a list that changes
  // under the reader skips and duplicates rows under offset pagination, and this one is
  // edited while it is being read.
  if (cursor) filter._id = { $lt: cursor }

  // One extra row tells us whether another page exists without a second count query.
  const rows = await Product.find(filter).sort({ _id: -1 }).limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
  }
}

export async function getById(id) {
  return findOrThrow(id)
}

export async function create(input, context) {
  // Derived rather than demanded — an admin naming a new donut should not have to know
  // what a slug is. An explicit one still wins.
  const slug = input.slug || slugify(input.name)

  if (!slug) {
    throw ApiError.badRequest(
      'Could not build a web address from that name — please provide a slug',
      { field: 'slug' }
    )
  }

  // A duplicate sku or slug surfaces as a 409 from the error handler's 11000 branch.
  const product = await Product.create({ ...input, slug })

  await audit.record({
    actor: context.actor,
    action: 'product.create',
    entity: 'Product',
    entityId: product._id,
    changes: {
      sku: product.sku,
      name: product.name,
      // Both forms: the stored integer is what a query joins on, the formatted string is
      // what a human reading this trail can check against a menu without dividing by 100.
      price: { to: product.price, formatted: formatPKR(product.price) },
    },
    ip: context.ip,
  })

  return product
}

/** The fields worth naming individually in the audit trail. */
const AUDITED_FIELDS = [
  'name',
  'slug',
  'category',
  'type',
  'price',
  'boxEligible',
  'isFeatured',
  'sortOrder',
  'isActive',
]

export async function update(id, payload, context) {
  const product = await findOrThrow(id)

  const before = AUDITED_FIELDS.reduce((acc, field) => {
    acc[field] = product[field]
    return acc
  }, {})

  Object.assign(product, payload)
  await product.save()

  // `diff` returns null rather than {} when nothing moved, so an edit that changed
  // nothing must not fall through into the price check below.
  const changes = audit.diff(before, product, AUDITED_FIELDS) ?? {}

  /**
   * A price move is called out separately and in rupees.
   *
   * `diff` already records `price: { from: 29900, to: 34900 }`, which is correct and
   * unreadable. Somebody scanning this trail for "when did the box of 12 jump" is
   * comparing against a printed menu, not against paisa.
   */
  if (changes.price) {
    changes.priceFormatted = {
      from: formatPKR(changes.price.from),
      to: formatPKR(changes.price.to),
    }
  }

  // An edit that changed nothing is not worth a row — it would only make the rows that
  // do matter harder to find.
  if (Object.keys(changes).length > 0) {
    await audit.record({
      actor: context.actor,
      action: 'product.update',
      entity: 'Product',
      entityId: product._id,
      // The SKU is what a human searching this trail has in hand; the entityId is what a
      // query joins on. Both, because they answer different questions.
      changes: { sku: product.sku, ...changes },
      ip: context.ip,
    })
  }

  return product
}

/**
 * Discontinues a product. Never removes one.
 *
 * Distinct from being out of stock, which is per branch and lives on BranchStock: this
 * takes the item off the menu everywhere and permanently, and a manager toggling stock
 * cannot bring it back. Reversible by PATCHing `isActive` to true, which is why there is
 * no separate restore endpoint.
 */
export async function remove(id, context) {
  const product = await findOrThrow(id)

  if (!product.isActive) {
    // Already off the menu. Reporting success would tell an admin their click did
    // something, and the next one to look would find no audit row explaining when.
    throw ApiError.conflict('This product is already discontinued', { sku: product.sku })
  }

  product.isActive = false
  await product.save()

  await audit.record({
    actor: context.actor,
    action: 'product.discontinue',
    entity: 'Product',
    entityId: product._id,
    changes: { sku: product.sku, name: product.name, isActive: { from: true, to: false } },
    ip: context.ip,
  })

  return product
}

/* ─── Product photos ──────────────────────────────────────────────────────────
 *
 * Uploading is a three-step round trip, and it is worth saying why it is not one.
 *
 *   1. POST .../images/upload-url   we sign a URL for one specific key
 *   2. PUT <uploadUrl>              the browser sends the file straight to S3
 *   3. POST .../images              the browser tells us the key; we verify and record
 *
 * Step 2 does not come through this API. `app.js` caps request bodies at 100kb, so a
 * photo could not be POSTed here even if we wanted it to be, and lifting that cap would
 * put every megabyte of every upload through EC2 memory on an instance sized for JSON.
 *
 * The cost of that design is step 3: the client tells us what it wrote, and a client can
 * lie. So step 3 trusts nothing — it checks the key is one we could have issued for this
 * product, and asks S3 what is actually there rather than believing the request.
 */

/**
 * How many photos one product may carry.
 *
 * A limit exists because nothing else stops an admin console bug from looping: without
 * it, a retry that re-attaches on every render grows an unbounded array inside a
 * document every catalogue read loads. Eight is well past what any product tile shows.
 */
export const MAX_IMAGES_PER_PRODUCT = 8

/**
 * Step 1. Hands back a URL the browser may PUT one file to.
 *
 * Nothing is written here — not to S3, not to the product. An upload that is started and
 * abandoned leaves no trace on the catalogue; at worst it leaves an unreferenced object
 * in the bucket, which is what the lifecycle rule in `.env.example` is for.
 *
 * The image cap is checked here as well as on attach, so an admin who is already at the
 * limit is told so before choosing a file rather than after waiting for it to upload.
 */
export async function createImageUpload(id, { filename, contentType, size }) {
  const product = await findOrThrow(id)

  if (product.images.length >= MAX_IMAGES_PER_PRODUCT) {
    throw ApiError.conflict(
      `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images — remove one first`,
      { sku: product.sku, count: product.images.length }
    )
  }

  return imageStorage.createUploadUrl({
    productId: String(product._id),
    filename,
    contentType,
    size,
  })
}

/**
 * Step 3. Records an uploaded object against the product.
 *
 * Every check here exists because the caller supplied the key.
 *
 * The prefix check stops one product claiming another's object — without it an admin
 * could attach a rival product's photo and then delete it out from under them, since
 * detaching removes the underlying object.
 *
 * The `statObject` call is what makes the URL real. A client that never completed the
 * PUT would otherwise write an image row pointing at a 404, and the first person to know
 * would be a customer looking at a broken tile.
 *
 * The type and size re-checks close the gap between what was declared in step 1 and what
 * was actually stored. S3 enforces both through the signature, so a mismatch means
 * something unusual happened — the object is removed rather than left orphaned, because
 * an object we have just refused to reference is one nothing will ever clean up.
 */
export async function attachImage(id, { key, alt }, context) {
  const product = await findOrThrow(id)

  if (product.images.length >= MAX_IMAGES_PER_PRODUCT) {
    throw ApiError.conflict(
      `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images — remove one first`,
      { sku: product.sku, count: product.images.length }
    )
  }

  if (!imageStorage.keyBelongsTo(key, String(product._id))) {
    throw ApiError.badRequest('That upload does not belong to this product', { field: 'key' })
  }

  // Attaching the same object twice would show the customer one photo in two slots and
  // make the first delete break the second.
  if (product.images.some((image) => image.publicId === key)) {
    throw ApiError.conflict('That image is already on this product', { key })
  }

  const object = await imageStorage.statObject(key)

  if (!object) {
    throw ApiError.badRequest(
      'No uploaded file was found for that key — the upload did not complete',
      { field: 'key' }
    )
  }

  if (!imageStorage.ALLOWED_IMAGE_TYPES[object.contentType]) {
    await imageStorage.deleteObject(key)
    throw ApiError.badRequest(`${object.contentType || 'That file'} is not an allowed image type`, {
      field: 'key',
    })
  }

  if (object.size > imageStorage.MAX_IMAGE_BYTES) {
    await imageStorage.deleteObject(key)
    throw ApiError.badRequest('That image is larger than the 5 MB limit', { field: 'key' })
  }

  product.images.push({
    url: imageStorage.publicUrlFor(key),
    publicId: key,
    // The product name is a better alt text than a filename, and the only one available
    // without a human writing one — same reasoning as the migration script.
    alt: alt || product.name,
    order: product.images.length,
  })

  await product.save()

  await audit.record({
    actor: context.actor,
    action: 'product.image.add',
    entity: 'Product',
    entityId: product._id,
    changes: { sku: product.sku, key, count: { from: product.images.length - 1, to: product.images.length } },
    ip: context.ip,
  })

  return product
}

/**
 * Removes a photo from the product and deletes the object behind it.
 *
 * Unlike a product, an image really is deleted. Nothing references it — an order line
 * snapshots the name and price it was bought at, never the picture — so there is no
 * history to protect and no reason to pay S3 to keep a file no page will load.
 *
 * The database write happens even if S3 refuses: `deleteObject` never throws, because
 * the admin asked for the photo to come off the site and a briefly unreachable bucket is
 * not a reason to tell them it did not. The orphan is logged.
 */
export async function removeImage(id, key, context) {
  const product = await findOrThrow(id)

  const index = product.images.findIndex((image) => image.publicId === key)

  if (index === -1) {
    throw ApiError.notFound('That image is not on this product')
  }

  product.images.splice(index, 1)

  // Re-sequenced rather than left with a hole. `order` is what the storefront sorts on,
  // and a gap is harmless until something starts treating the value as an index.
  product.images.forEach((image, position) => {
    image.order = position
  })

  await product.save()
  await imageStorage.deleteObject(key)

  await audit.record({
    actor: context.actor,
    action: 'product.image.remove',
    entity: 'Product',
    entityId: product._id,
    changes: { sku: product.sku, key, count: { from: product.images.length + 1, to: product.images.length } },
    ip: context.ip,
  })

  return product
}
