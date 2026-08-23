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
