/**
 * Seeds branches, the catalogue, per-branch stock, and staff accounts.
 *
 *   npm run seed            upsert — safe to re-run, keeps existing _ids
 *   npm run seed -- --fresh drop and recreate (development only)
 *
 * Upsert rather than insert is the default deliberately: orders reference products by
 * _id, so a seed that recreated rows would orphan every line item in an order history
 * the first time someone re-ran it to fix a typo in a description.
 */
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { toStoredAmount } from '../utils/money.js'
import { STAFF_ROLE } from '../config/constants.js'
import { Product } from '../models/Product.js'
import { Branch } from '../models/Branch.js'
import { BranchStock } from '../models/BranchStock.js'
import { StaffUser } from '../models/StaffUser.js'
import { CATALOGUE } from '../itemData.js'

// Prices are written in rupees and converted to the stored form here, so the table stays
// readable and there is exactly one place the conversion can go wrong.
const rs = toStoredAmount

/**
 * The four real branches.
 *
 * Coordinates come from the client's own Google Maps share links, read from the `!3d`/`!4d`
 * pin data rather than the `@` camera position — the two differ by up to a few hundred
 * metres and only the former is the shop.
 *
 *   DHA1  https://maps.app.goo.gl/u2JAca5Y417zZqKDA
 *   DHA2  https://maps.app.goo.gl/FpMqvCfDgAEbdKbq5
 *   BAH4  https://maps.app.goo.gl/4T5J2terGJASwiYs6
 *   NUST  https://maps.app.goo.gl/TuRTaUub9bU7p38Q8   (directions link; the destination is
 *                                                      the SINES/NSTP building — the outlet
 *                                                      trades inside it)
 *
 * A second set of links was later supplied for DHA1, DHA2 and BAH4. They carry the same
 * Google feature ids (`ftid`) as the three above, i.e. the same places, so the coordinates
 * below are confirmed from two independent shares rather than assumed from one.
 *
 * The phone number is shared by all four on the client's instruction: every branch
 * carries the storefront line, which is also the WhatsApp sender. Per-branch numbers
 * would still read better in the templates ("call us on <branch number>"), but a shared
 * correct number is not a gap — it is the number the shop answers.
 *
 * ⚠️ Geography note — the 2 km radius does NOT cover the gaps between these. See the
 * warning the seed prints, and BACKEND-INPUTS §2.
 */

/**
 * The one published Sugarloop number — the storefront line, which is also the WhatsApp
 * Business sender. It is what the site already dials from the cart, the checkout and the
 * footer, so a customer reading a branch's number off an order sees the same one they
 * would have called anyway.
 */
const SHARED_PHONE = '+92 370 4193372'

const branches = [
  {
    code: 'DHA1',
    name: 'Sugar Loop DHA 1',
    address: 'H32V+J2F, DHA Phase 1, Islamabad',
    city: 'Islamabad',
    location: { type: 'Point', coordinates: [73.0925354, 33.5515545] },
    hours: { open: '16:00', close: '00:00' },
    fulfilment: ['pickup'],
  },
  {
    code: 'DHA2',
    name: 'Sugar Loop DHA 2',
    address: '1st Floor, Nadir Arcade, Sector E, DHA Phase II, Islamabad',
    city: 'Islamabad',
    location: { type: 'Point', coordinates: [73.1574172, 33.5312498] },
    // Open for collection from 10:00; riders go out 16:00 to midnight (2026-09-18).
    hours: { open: '10:00', close: '00:00' },
    deliveryHours: { open: '16:00', close: '00:00' },
    // The only branch that delivers, for now.
    fulfilment: ['delivery', 'pickup'],
  },
  {
    // Bahria Town Phase 4, NOT DHA Phase 4 — Marina Commercial and Corniche Road are
    // Bahria, and postcode 46220 is Bahria/Rawalpindi rather than DHA Islamabad.
    code: 'BAH4',
    name: 'Sugar Loop Bahria Phase 4',
    address: 'Marina Commercial, Corniche Road, near WeDrink, Bahria Town Phase 4, Islamabad 46220',
    city: 'Islamabad',
    location: { type: 'Point', coordinates: [73.1233008, 33.5465939] },
    hours: { open: '16:00', close: '00:00' },
    fulfilment: ['pickup'],
  },
  {
    // Not in DHA, and 13-19 km from the other three. Kept in the same list because it is
    // the same business, but see the coverage warning — it is an island.
    code: 'NUST',
    name: 'Sugar Loop NUST H-12',
    address: 'SINES / NSTP Building, NUST, Khyber Road, H-12, Islamabad 44000',
    city: 'Islamabad',
    location: { type: 'Point', coordinates: [72.9974445, 33.6461047] },
    // Daytime, unlike the rest — it trades inside a university building.
    hours: { open: '10:00', close: '18:00' },
    fulfilment: ['pickup'],
  },
].map((branch) => ({
  ...branch,
  phone: SHARED_PHONE,
  /*
   * Hours and fulfilment are per branch, above, on the client's instruction of 2026-09-17:
   *   NUST              10:00-18:00
   *   DHA1, BAH4        16:00-00:00
   *   DHA2              10:00-00:00 for collection, delivery 16:00-00:00 (2026-09-18)
   * Collection runs until closing; delivery stops 30 minutes before (lastOrderBufferMinutes
   * only applies to delivery — see Branch.lastOrderBufferFor).
   * Delivery runs from DHA2 only for now; the other three are collection only. Adding
   * `'delivery'` back to a branch's `fulfilment` is all it takes to open it up.
   *
   * ⚠️ The seed OVERWRITES hours and fulfilment on every run, including any a manager
   * changed through the staff console since.
   */
  // Written explicitly, not left to the model default: that default only applies on
  // insert, so a branch deactivated by an earlier seed would otherwise stay closed.
  isActive: true,
  // Straight-line fallback for when ROUTER is not osrm; matches the 5 km road limit below.
  deliveryRadiusKm: 5,
  // The rule that replaces the radius when ROUTER=osrm: 5 km, the ceiling the client set
  // on how far a rider is sent. ROAD km, not straight-line, so it means five kilometres
  // of actual riding. No time cap — distance is the rule, and it is the one the refusal
  // message states.
  maxDeliveryMinutes: null,
  maxDeliveryRoadKm: 5,
  // Delivery only: the last delivery order is half an hour before close. Collection runs to close.
  lastOrderBufferMinutes: 30,
}))

/**
 * The real catalogue, transcribed from the frontend's `productsData.js` into
 * `src/itemData.js`. Prices are confirmed by the client.
 *
 * `sourceImages` is dropped rather than left for Mongoose's strict mode to discard
 * silently — it is provenance for the image migration, not a field the Product document
 * has. `legacyId` IS persisted: the live site keys localStorage carts by it (kickoff §2).
 *
 * `images` stays empty because the seed has no bytes to point at — the schema requires a
 * `publicId` per image, so there is nothing honest to put there. `npm run images:upload`
 * fills them from the frontend bundle once a bucket exists; until then the frontend
 * renders a neutral placeholder tile.
 */
const products = CATALOGUE.map(({ sourceImages: _sourceImages, price, ...product }) => ({
  ...product,
  price: rs(price),
  images: [],
}))

/**
 * Kickoff §2 acceptance check: every price ported correctly sums to Rs 18,195.
 *
 * Asserted at seed time rather than left to a test, because the failure it catches is a
 * transcription typo — a donut seeded at Rs 29 instead of Rs 299 — which is invisible in
 * a passing seed, sells at the wrong price to real customers, and is only ever noticed by
 * whoever reconciles the till.
 */
// Was 43 items / Rs 18,195 for the original transcription. Added since: the Blueberry
// donut (Rs 299) and the four brownies (Rs 420 + 399 + 399 + 370 = Rs 1,588). Both are
// genuine menu additions, so the expectations move with them rather than the guard being
// relaxed — it still catches the typo it was written for. Removed since: Brownie Filled
// (Rs 299) and Snickers (Rs 429), commented out in itemData.js until the client supplies
// their description copy, which is why 48 / Rs 20,082 became 46 / Rs 19,354.
const EXPECTED_CATALOGUE_COUNT = 46
const EXPECTED_PRICE_SUM = 1_935_400

function assertCatalogueIntegrity() {
  const sum = products.reduce((total, product) => total + product.price, 0)

  if (products.length !== EXPECTED_CATALOGUE_COUNT) {
    throw new Error(
      `Catalogue has ${products.length} products, expected ${EXPECTED_CATALOGUE_COUNT}. ` +
        'If the menu genuinely changed, update EXPECTED_* in this file and say so in the commit.'
    )
  }

  if (sum !== EXPECTED_PRICE_SUM) {
    throw new Error(
      `Catalogue prices sum to Rs ${sum / 100}, expected Rs ${EXPECTED_PRICE_SUM / 100}. ` +
        `Off by Rs ${(sum - EXPECTED_PRICE_SUM) / 100} — likely a transcription error in itemData.js.`
    )
  }
}

// Staff are keyed by email; `branchCode` is resolved to an _id once branches exist.
const staffAccounts = [
  { email: 'admin@sugarloop.pk', name: 'Sugarloop Admin', role: STAFF_ROLE.ADMIN },
  { email: 'dha1.manager@sugarloop.pk', name: 'DHA 1 Manager', role: STAFF_ROLE.BRANCH_MANAGER, branchCode: 'DHA1' },
  { email: 'dha2.manager@sugarloop.pk', name: 'DHA 2 Manager', role: STAFF_ROLE.BRANCH_MANAGER, branchCode: 'DHA2' },
  { email: 'bahria4.manager@sugarloop.pk', name: 'Bahria Phase 4 Manager', role: STAFF_ROLE.BRANCH_MANAGER, branchCode: 'BAH4' },
  // There is no DHA Phase 5 branch — that was a placeholder. NUST H-12 replaces it.
  { email: 'nust.manager@sugarloop.pk', name: 'NUST H-12 Manager', role: STAFF_ROLE.BRANCH_MANAGER, branchCode: 'NUST' },
]

async function upsertAll(Model, docs, key) {
  const result = { created: 0, updated: 0 }

  for (const doc of docs) {
    // includeResultMetadata, not the older `rawResult` — the latter is a silent no-op
    // in Mongoose 8 and returns a plain document, which would report every existing
    // row as newly created.
    const outcome = await Model.findOneAndUpdate(
      { [key]: doc[key] },
      { $set: doc },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
        includeResultMetadata: true,
      }
    )
    if (outcome.lastErrorObject?.updatedExisting) result.updated += 1
    else result.created += 1
  }

  return result
}

/**
 * Retires products that are in the database but no longer in the catalogue.
 *
 * Upserting by SKU only ever adds and updates, so without this an item taken off the menu
 * would keep selling forever — the seed would run clean and the deleted donut would still
 * be orderable. That is a production bug, not just a tidiness one.
 *
 * Deactivated, never deleted: past orders reference these documents by _id, and an order
 * whose lines cannot resolve a product is one nobody can reprint, refund or dispute.
 * `isActive: false` hides it from the site and the pricing engine while keeping history
 * intact. Their BranchStock rows are left alone for the same reason — they are keyed to a
 * product that still exists, they cost nothing, and the item is already unsellable.
 *
 * Reactivation is automatic: putting the SKU back in the catalogue sets isActive true
 * again on the next seed, since the upsert writes the model default.
 */
async function retireMissingProducts() {
  const currentSkus = products.map((product) => product.sku)

  const stale = await Product.find({ sku: { $nin: currentSkus }, isActive: true }, 'sku name')
  if (stale.length === 0) return { retired: 0, names: [] }

  await Product.updateMany({ _id: { $in: stale.map((p) => p._id) } }, { $set: { isActive: false } })

  return { retired: stale.length, names: stale.map((p) => p.sku) }
}

/**
 * Retires branches that are in the database but no longer in the seed.
 *
 * Same reasoning as retireMissingProducts, and the same bug it prevents: DHA5 was a
 * placeholder that turned out not to exist, and without this it would have stayed live
 * and orderable forever, quietly accepting orders for a kitchen that isn't there.
 *
 * Deactivated, never deleted — past orders reference a branch by _id.
 */
async function retireMissingBranches() {
  const currentCodes = branches.map((branch) => branch.code)

  const stale = await Branch.find({ code: { $nin: currentCodes }, isActive: true }, 'code')
  if (stale.length === 0) return { retired: 0, codes: [] }

  await Branch.updateMany({ _id: { $in: stale.map((b) => b._id) } }, { $set: { isActive: false } })

  return { retired: stale.length, codes: stale.map((b) => b.code) }
}

/**
 * Every branch x product pair, defaulting to in stock.
 *
 * Written with `$setOnInsert` so a re-seed never un-sells-out an item a manager
 * deliberately turned off ten minutes ago.
 */
async function seedBranchStock() {
  const [branchIds, productIds] = await Promise.all([
    Branch.find({}, '_id').then((rows) => rows.map((row) => row._id)),
    // Retired products get no new stock rows — there is nothing to toggle on an item
    // that cannot be ordered, and it would clutter every manager's stock screen.
    Product.find({ isActive: true }, '_id').then((rows) => rows.map((row) => row._id)),
  ])

  const operations = branchIds.flatMap((branchId) =>
    productIds.map((productId) => ({
      updateOne: {
        filter: { branchId, productId },
        update: { $setOnInsert: { branchId, productId, inStock: true } },
        upsert: true,
      },
    }))
  )

  if (operations.length === 0) return { created: 0, existing: 0 }

  const result = await BranchStock.bulkWrite(operations, { ordered: false })
  return {
    created: result.upsertedCount,
    existing: operations.length - result.upsertedCount,
  }
}

/**
 * Seeds staff accounts WITHOUT ever touching an existing password.
 *
 * findOneAndUpdate is wrong here: it bypasses the pre-save hook, so a password would be
 * written to the database in clear text. Beyond that, a re-seed must never reset the
 * password of a real account someone is already using.
 */
async function seedStaff(password) {
  const branchIds = new Map(
    (await Branch.find({}, 'code')).map((branch) => [branch.code, branch._id])
  )

  const result = { created: 0, updated: 0 }

  for (const { branchCode, ...account } of staffAccounts) {
    const branchId = branchCode ? branchIds.get(branchCode) : null
    if (branchCode && !branchId) {
      throw new Error(`Staff seed references unknown branch ${branchCode}`)
    }

    const existing = await StaffUser.findOne({ email: account.email })

    if (existing) {
      // Profile fields only. Password and lockout state are left exactly as they are.
      existing.set({ ...account, branchId })
      await existing.save()
      result.updated += 1
      continue
    }

    // Assigned to passwordHash because the pre-save hook hashes that path. It is the
    // plain password for exactly as long as it takes save() to run.
    await StaffUser.create({ ...account, branchId, passwordHash: password })
    result.created += 1
  }

  return result
}

async function seed() {
  // Before touching the database — a bad catalogue should never reach a write.
  assertCatalogueIntegrity()

  const fresh = process.argv.includes('--fresh')

  if (fresh && !env.isDevelopment) {
    // --fresh deletes the live catalogue. Development is the only place that is a
    // recoverable mistake.
    logger.fatal(`Refusing to run --fresh with NODE_ENV=${env.NODE_ENV}`)
    process.exit(1)
  }

  // Read straight from process.env rather than config/env.js: this is a script-only
  // input, and making it part of the validated boot schema would require every running
  // container to carry a seed password it has no use for.
  const providedPassword = process.env.SEED_ADMIN_PASSWORD

  if (!providedPassword && !env.isDevelopment) {
    logger.fatal('SEED_ADMIN_PASSWORD is required to seed staff outside development')
    process.exit(1)
  }

  // A generated password is printed once and never stored anywhere else. A hardcoded
  // default would be identical on every install and would eventually reach production.
  const staffPassword = providedPassword ?? `dev-${crypto.randomBytes(9).toString('base64url')}`

  await connectDatabase()

  if (fresh) {
    const removed = await Promise.all([
      Product.deleteMany({}),
      Branch.deleteMany({}),
      BranchStock.deleteMany({}),
      StaffUser.deleteMany({}),
    ])
    const [p, b, s, u] = removed.map((r) => r.deletedCount)
    logger.warn(`--fresh: removed ${p} products, ${b} branches, ${s} stock rows, ${u} staff`)
  }

  // Unique indexes on sku, slug, code, email and {branchId, productId} are what make
  // re-running safe. syncIndexes builds them before the first write, not lazily after.
  await Promise.all([
    Product.syncIndexes(),
    Branch.syncIndexes(),
    BranchStock.syncIndexes(),
    StaffUser.syncIndexes(),
  ])

  const branchResult = await upsertAll(Branch, branches, 'code')
  const retiredBranches = await retireMissingBranches()
  const productResult = await upsertAll(Product, products, 'sku')
  // After the upsert: anything still not in the catalogue has genuinely left the menu.
  const retireResult = await retireMissingProducts()
  // After both: a stock row needs a branch and a product to point at.
  const stockResult = await seedBranchStock()
  // After branches: a branch manager cannot be created without a branch.
  const staffResult = await seedStaff(staffPassword)

  logger.info(
    `Branches:  ${branchResult.created} created, ${branchResult.updated} updated ` +
      `(${await Branch.countDocuments({ isActive: true })} active)`
  )

  if (retiredBranches.retired > 0) {
    logger.warn(
      `Retired:   ${retiredBranches.retired} branch(es) no longer in the seed, ` +
        `deactivated not deleted — ${retiredBranches.codes.join(', ')}`
    )
  }
  logger.info(
    `Products:  ${productResult.created} created, ${productResult.updated} updated ` +
      `(${await Product.countDocuments({ isActive: true })} active)`
  )

  if (retireResult.retired > 0) {
    logger.warn(
      `Retired:   ${retireResult.retired} product(s) no longer in the catalogue, ` +
        `deactivated not deleted — ${retireResult.names.join(', ')}`
    )
  }
  logger.info(
    `Stock:     ${stockResult.created} created, ${stockResult.existing} left as-is ` +
      `(${await BranchStock.countDocuments()} rows)`
  )
  logger.info(
    `Staff:     ${staffResult.created} created, ${staffResult.updated} updated ` +
      `(${await StaffUser.countDocuments()} total)`
  )

  // Printed only for accounts this run actually created, and only when the password was
  // generated rather than supplied. Nothing is echoed on a re-run of existing accounts.
  if (staffResult.created > 0 && !providedPassword) {
    logger.warn(`Generated staff password (shown once): ${staffPassword}`)
    logger.warn('Sign in as admin@sugarloop.pk and change it before this reaches anyone else.')
  }

  // Reported, not warned about: each branch serving its own 2 km radius independently is
  // the client's decision, not a misconfiguration. Branches share nothing — an address is
  // served by the one shop that covers it, or by none. The number is here so the coverage
  // is a known quantity rather than a surprise, and because it is one field per branch to
  // change if the shop ever wants to reach further.
  logger.info(
    'COVERAGE: only DHA2 delivers, so an address outside its range is refused with ' +
      '"we do not deliver to your area" — including ones next to DHA1, BAH4 or NUST, ' +
      'which are collection only for now.'
  )
  logger.warn(
    'BRANCH PHONE: all four carry the storefront line +92 370 4193372, as instructed. ' +
      'It is also the WhatsApp sender, so every template that ends with ' +
      '"call us on <branch number>" names a number the shop actually answers. Per-branch ' +
      'numbers remain a later refinement, not a blocker.'
  )
  logger.info(
    'BRANCH HOURS: NUST 10:00-18:00; DHA1 and BAH4 16:00-00:00; DHA2 10:00-00:00, delivering 16:00-00:00. Collection until ' +
      'close; delivery stops 30 minutes earlier, and runs from DHA2 only for now.'
  )
  logger.warn(
    'NO PRODUCT IMAGES: the catalogue seeds with an empty images array. Run ' +
      'npm run images:upload once S3_BUCKET and S3_REGION are set and the instance role ' +
      'grants s3:PutObject/GetObject/DeleteObject; itemData.js keeps the frontend asset ' +
      'names per product so the mapping is not lost.'
  )

  logger.info('Seed complete')
}

seed()
  .then(async () => {
    await disconnectDatabase()
    process.exit(0)
  })
  .catch(async (err) => {
    logger.fatal({ err }, 'Seed failed')
    // Best effort — the connection may be the thing that broke.
    if (mongoose.connection.readyState === 1) await disconnectDatabase().catch(() => {})
    process.exit(1)
  })
