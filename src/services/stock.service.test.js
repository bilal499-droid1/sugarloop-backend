import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { Branch } from '../models/Branch.js'
import { Product } from '../models/Product.js'
import { BranchStock } from '../models/BranchStock.js'
import { StaffUser } from '../models/StaffUser.js'
import { AuditLog } from '../models/AuditLog.js'
import * as stockService from './stock.service.js'
import { STAFF_ROLE } from '../config/constants.js'
import { connectTestDatabase, disconnectTestDatabase } from '../testing/mongoTestDb.js'

/**
 * Integration tests. The behaviour under test is mostly about rows that do NOT exist —
 * upsert on first toggle, and "no row means in stock" — which is not observable against
 * a stub.
 */
const { connected, skip } = await connectTestDatabase('stock')

let dha2
let nust
let kitkat
let oreo
let latte
let discontinued
let admin
let dha2Manager

const branchFixture = (code, name, coordinates) => ({
  code,
  name,
  address: 'Somewhere in Islamabad',
  city: 'Islamabad',
  phone: '+92 51 111 557 799',
  location: { type: 'Point', coordinates },
  hours: { open: '11:00', close: '03:00' },
  lastOrderBufferMinutes: 30,
})

async function seedFixtures() {
  await Promise.all([
    Branch.deleteMany({}),
    Product.deleteMany({}),
    BranchStock.deleteMany({}),
    StaffUser.deleteMany({}),
    AuditLog.deleteMany({}),
  ])

  dha2 = await Branch.create(branchFixture('DHA2', 'Sugar Loop DHA 2', [73.1574172, 33.5312498]))
  nust = await Branch.create(branchFixture('NUST', 'Sugar Loop NUST H-12', [72.9974445, 33.6461047]))

  kitkat = await Product.create({
    sku: 'DON-KITKAT-CRUNCH',
    slug: 'kitkat-crunch',
    name: 'KitKat Crunch',
    category: 'Donuts',
    price: 42_900,
  })

  oreo = await Product.create({
    sku: 'DON-CLASSIC-OREO',
    slug: 'classic-oreo',
    name: 'Classic Oreo',
    category: 'Donuts',
    price: 18_500,
  })

  latte = await Product.create({
    sku: 'DRK-LATTE',
    slug: 'latte',
    name: 'Latte',
    category: 'Drinks',
    price: 45_000,
  })

  discontinued = await Product.create({
    sku: 'DON-RETIRED',
    slug: 'retired-donut',
    name: 'Retired Donut',
    category: 'Donuts',
    price: 20_000,
    isActive: false,
  })

  // Deliberately only ONE row: the rest of the catalogue has never been toggled here,
  // which is the state the whole "missing row means in stock" rule exists for.
  await BranchStock.create({ branchId: dha2._id, productId: kitkat._id, inStock: false })

  admin = await StaffUser.create({
    name: 'Admin',
    email: 'admin@sugarloop.pk',
    passwordHash: 'a-long-enough-password',
    role: STAFF_ROLE.ADMIN,
    branchId: null,
  })

  dha2Manager = await StaffUser.create({
    name: 'DHA2 Manager',
    email: 'dha2@sugarloop.pk',
    passwordHash: 'a-long-enough-password',
    role: STAFF_ROLE.BRANCH_MANAGER,
    branchId: dha2._id,
  })
}

const ctx = (actor) => ({ actor, ip: '127.0.0.1' })

const stockOf = (items, product) =>
  items.find((item) => String(item.product._id) === String(product._id))?.inStock

test('stock toggles', { skip, concurrency: false }, async (t) => {
  t.beforeEach(seedFixtures)
  t.after(() => disconnectTestDatabase(connected))

  await t.test('the sheet lists every sellable product, toggled or not', async () => {
    const { branch, items } = await stockService.list({}, dha2Manager)

    assert.equal(branch.code, 'DHA2')
    assert.equal(items.length, 3, 'three active products; the discontinued one is not for sale')

    assert.equal(stockOf(items, kitkat), false, 'the one row that exists')
    assert.equal(stockOf(items, oreo), true, 'no row — in stock by default')
    assert.equal(stockOf(items, latte), true)

    // A discontinued item cannot be brought back by flipping a toggle, so it is not
    // offered as one.
    assert.equal(
      items.some((item) => String(item.product._id) === String(discontinued._id)),
      false
    )
  })

  await t.test('a never-toggled product reports no update time', async () => {
    const { items } = await stockService.list({}, dha2Manager)

    // "Never been touched" reads differently on a dashboard from "set in stock at 09:12".
    assert.equal(stockOf(items, kitkat), false)
    assert.ok(items.find((item) => String(item.product._id) === String(kitkat._id)).updatedAt)
    assert.equal(
      items.find((item) => String(item.product._id) === String(oreo._id)).updatedAt,
      null
    )
  })

  await t.test('filters by category and by availability', async () => {
    const donuts = await stockService.list({ category: 'Donuts' }, dha2Manager)
    assert.equal(donuts.items.length, 2)

    // The dashboard's default view: what is sold out right now.
    const soldOut = await stockService.list({ inStock: false }, dha2Manager)
    assert.equal(soldOut.items.length, 1)
    assert.equal(soldOut.items[0].product.sku, 'DON-KITKAT-CRUNCH')

    const available = await stockService.list({ inStock: true }, dha2Manager)
    assert.equal(available.items.length, 2)
  })

  await t.test('the first toggle creates the row', async () => {
    assert.equal(await BranchStock.countDocuments({ branchId: dha2._id, productId: oreo._id }), 0)

    const { row } = await stockService.setStock(oreo._id, { inStock: false }, ctx(dha2Manager))

    assert.equal(row.inStock, false)
    assert.equal(String(row.updatedBy), String(dha2Manager._id))
    assert.equal(await BranchStock.countDocuments({ branchId: dha2._id, productId: oreo._id }), 1)
  })

  await t.test('a toggle is audited with the sku and the branch', async () => {
    await stockService.setStock(oreo._id, { inStock: false }, ctx(dha2Manager))

    const entries = await AuditLog.find({ action: 'stock.toggle' })

    assert.equal(entries.length, 1)
    assert.equal(String(entries[0].actorId), String(dha2Manager._id))
    assert.equal(entries[0].changes.sku, 'DON-CLASSIC-OREO')
    assert.equal(entries[0].changes.branchCode, 'DHA2')
    assert.deepEqual(entries[0].changes.inStock, { from: true, to: false })
  })

  await t.test('setting a value it already has is a no-op, not an audit entry', async () => {
    // A double-tap in a hot kitchen should not fill the trail with rows recording nothing.
    await stockService.setStock(oreo._id, { inStock: true }, ctx(dha2Manager))
    await stockService.setStock(kitkat._id, { inStock: false }, ctx(dha2Manager))

    assert.equal(await AuditLog.countDocuments({ action: 'stock.toggle' }), 0)
  })

  await t.test('two toggles of the same product never make two rows', async () => {
    await stockService.setStock(oreo._id, { inStock: false }, ctx(dha2Manager))
    await stockService.setStock(oreo._id, { inStock: true }, ctx(dha2Manager))

    // The unique index is what enforces this; the upsert is what respects it.
    assert.equal(await BranchStock.countDocuments({ branchId: dha2._id, productId: oreo._id }), 1)
    assert.equal(await AuditLog.countDocuments({ action: 'stock.toggle' }), 2)
  })

  await t.test('a toggle at one branch does not touch another', async () => {
    await stockService.setStock(oreo._id, { inStock: false }, ctx(dha2Manager))

    const atNust = await stockService.list({ branchId: String(nust._id) }, admin)

    // The entire reason BranchStock is its own collection: an empty tray at DHA2 must
    // not hide the item across the city.
    assert.equal(stockOf(atNust.items, oreo), true)
    assert.equal(stockOf(atNust.items, kitkat), true, 'DHA2 sold out; NUST has not')
  })

  await t.test('a branch manager cannot toggle another branch', async () => {
    await assert.rejects(
      () =>
        stockService.setStock(oreo._id, { inStock: false, branchId: String(nust._id) }, ctx(dha2Manager)),
      (err) => err.statusCode === 403
    )

    await assert.rejects(
      () => stockService.list({ branchId: String(nust._id) }, dha2Manager),
      (err) => err.statusCode === 403
    )

    assert.equal(await BranchStock.countDocuments({ branchId: nust._id }), 0, 'nothing written')
  })

  await t.test('an admin must say which branch — there is no "all branches" answer', async () => {
    await assert.rejects(
      () => stockService.list({}, admin),
      (err) => err.statusCode === 422
    )

    await assert.rejects(
      () => stockService.setStock(oreo._id, { inStock: false }, ctx(admin)),
      (err) => err.statusCode === 422
    )

    // Naming one works.
    const { items } = await stockService.list({ branchId: String(nust._id) }, admin)
    assert.equal(items.length, 3)
  })

  await t.test('an unknown or discontinued product is 404', async () => {
    await assert.rejects(
      () =>
        stockService.setStock(new mongoose.Types.ObjectId(), { inStock: false }, ctx(dha2Manager)),
      (err) => err.statusCode === 404
    )

    await assert.rejects(
      () => stockService.setStock(discontinued._id, { inStock: false }, ctx(dha2Manager)),
      (err) => err.statusCode === 404
    )
  })

  await t.test('an unknown branch is 404', async () => {
    await assert.rejects(
      () => stockService.list({ branchId: String(new mongoose.Types.ObjectId()) }, admin),
      (err) => err.statusCode === 404
    )
  })
})
