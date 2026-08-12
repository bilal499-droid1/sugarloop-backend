/**
 * The pricing engine. THE single place a cart becomes money.
 *
 * Pure by construction: it takes products and stock that a caller has already loaded, and
 * returns a priced quote or throws. No database, no clock of its own, no HTTP. That is
 * what lets the arithmetic be tested exhaustively — and this is the code where a bug is
 * somebody's bill, so it gets tested exhaustively.
 *
 * The rule the whole file exists to enforce:
 *
 *   THE BROWSER NEVER SENDS A PRICE.
 *
 * The request carries product ids and quantities. Every price is read from the product
 * documents the caller loaded from the database. Anything else in the request body —
 * `price`, `total`, `lineTotal` — is not read here and cannot be. The validator strips
 * unknown keys before this is ever called, and this function only ever looks at
 * `productId`, `qty`, `boxSize` and `productIds`.
 *
 * Both `POST /checkout/quote` and `POST /orders` call this, so a quote and the order it
 * becomes cannot disagree about what something costs.
 */
import {
  BOX_SIZES,
  CURRENCY,
  DELIVERY_FEE,
  FULFILMENT,
  MIN_ORDER_VALUE,
  PROMISED_MINUTES,
} from '../config/constants.js'
import { multiply, sum } from '../utils/money.js'
import { ApiError } from '../utils/ApiError.js'

const MS_PER_MINUTE = 60_000

/**
 * Splits a gross or net amount into the FBR-shaped breakdown (design §9b).
 *
 * At 0% tax — every product today — this is `net === gross, tax === 0`. It is computed
 * anyway because FBR reports per line item, and retrofitting a breakdown onto orders that
 * were only ever stored as totals means rebuilding the schema and re-deriving history.
 *
 * `taxAmount` is always the DIFFERENCE between gross and net rather than a second rounded
 * multiplication, so the three numbers reconcile exactly at any rate. Computing tax
 * independently is how a line ends up a hundredth of a rupee out from its own components.
 */
export function taxBreakdown(amount, taxRatePercent = 0, priceIncludesTax = true) {
  if (!taxRatePercent) {
    return { netAmount: amount, taxRate: 0, taxAmount: 0, grossAmount: amount }
  }

  const rate = taxRatePercent / 100

  if (priceIncludesTax) {
    // The shelf price already contains the tax; work backwards out of it.
    const netAmount = Math.round(amount / (1 + rate))
    return {
      netAmount,
      taxRate: taxRatePercent,
      taxAmount: amount - netAmount,
      grossAmount: amount,
    }
  }

  const grossAmount = Math.round(amount * (1 + rate))
  return {
    netAmount: amount,
    taxRate: taxRatePercent,
    taxAmount: grossAmount - amount,
    grossAmount,
  }
}

/**
 * Is this branch able to take the order right now?
 *
 * Deliberately NOT "find another branch that can". Branches do not share orders: each
 * serves its own radius, and a closed or paused branch means a refusal rather than a
 * silent hand-off to a neighbour that the customer never chose and whose stock differs.
 * (This departs from BACKEND-DESIGN §4, which resolved to the nearest OPEN branch. The
 * client confirmed branches operate independently.)
 */
function assertBranchCanAccept(branch, fulfilment, now) {
  if (!branch.fulfilment.includes(fulfilment)) {
    throw new ApiError(
      409,
      'FULFILMENT_UNAVAILABLE',
      `${branch.name} does not offer ${fulfilment}`,
      { branchCode: branch.code, offered: branch.fulfilment }
    )
  }

  if (branch.isAcceptingOrdersAt(now)) return

  // Separate the two closed cases: "we shut at 3am, come back at 11" is a different
  // message from "we are open but the kitchen has stopped taking orders".
  const isTrading = branch.isOpenAt(now)

  throw new ApiError(
    409,
    'BRANCH_NOT_ACCEPTING_ORDERS',
    isTrading
      ? `${branch.name} has stopped taking orders for tonight`
      : `${branch.name} is closed`,
    {
      branchCode: branch.code,
      isOpenNow: isTrading,
      opensAt: branch.nextOpeningAt(now),
      hours: { open: branch.hours.open, close: branch.hours.close },
    }
  )
}

/** A single catalogue item on the cart. */
function buildProductLine(item, { productsById, isInStock, problems }) {
  const product = productsById.get(String(item.productId))

  if (!product) {
    problems.unavailable.push(String(item.productId))
    return null
  }

  if (!isInStock(product._id)) {
    // Pushed by NAME, not id — so the UI can say "Lotus is sold out at DHA 2" rather
    // than showing a customer an ObjectId.
    problems.outOfStock.push(product.name)
    return null
  }

  const lineTotal = multiply(product.price, item.qty)

  return {
    kind: 'product',
    productId: String(product._id),
    sku: product.sku,
    name: product.name,
    unitPrice: product.price,
    qty: item.qty,
    lineTotal,
    ...taxBreakdown(lineTotal, product.taxRatePercent, product.priceIncludesTax),
  }
}

/**
 * A Build Your Box line.
 *
 * Rules (BACKEND-INPUTS §11): a box of N holds EXACTLY N items, duplicates are allowed,
 * Crafted Donuts are eligible, categories may mix, and the price is the plain sum of the
 * contents — no packaging charge, no bundle discount.
 *
 * Note what is NOT enforced: single-category boxes. The current frontend forbids mixing
 * donuts and croissants; that restriction is being removed, so enforcing it server-side
 * would re-impose a rule the client explicitly dropped.
 */
function buildBoxLine(item, { productsById, isInStock, problems, index }) {
  if (!BOX_SIZES.includes(item.boxSize)) {
    throw new ApiError(422, 'INVALID_BOX', `A box must be one of ${BOX_SIZES.join(', ')} items`, {
      itemIndex: index,
      boxSize: item.boxSize,
      allowed: BOX_SIZES,
    })
  }

  if (item.productIds.length !== item.boxSize) {
    throw new ApiError(
      422,
      'INVALID_BOX',
      `A box of ${item.boxSize} must contain exactly ${item.boxSize} items, got ${item.productIds.length}`,
      { itemIndex: index, boxSize: item.boxSize, received: item.productIds.length }
    )
  }

  const children = []
  let boxIsSound = true

  for (const productId of item.productIds) {
    const product = productsById.get(String(productId))

    if (!product) {
      problems.unavailable.push(String(productId))
      boxIsSound = false
      continue
    }

    if (!product.boxEligible) {
      problems.notBoxEligible.push(product.name)
      boxIsSound = false
      continue
    }

    if (!isInStock(product._id)) {
      problems.outOfStock.push(product.name)
      boxIsSound = false
      continue
    }

    children.push({
      productId: String(product._id),
      sku: product.sku,
      name: product.name,
      unitPrice: product.price,
    })
  }

  if (!boxIsSound) return null

  // Price is the sum of the contents. Duplicates are counted, because the customer is
  // getting two of them.
  const lineTotal = sum(children.map((child) => child.unitPrice))

  return {
    kind: 'box',
    name: `Box of ${item.boxSize}`,
    boxSize: item.boxSize,
    qty: 1,
    unitPrice: lineTotal,
    lineTotal,
    children,
    // Tax rides at the box level here because every product is 0% today. When a real rate
    // arrives and products differ, this has to become a per-child split — the children are
    // already itemised, which is exactly why they are stored.
    ...taxBreakdown(lineTotal),
  }
}

/** Everything wrong with the cart, in one error, so the UI shows it all at once. */
function throwIfUnsatisfiable(problems, branch) {
  const details = {}
  const parts = []

  if (problems.unavailable.length > 0) {
    details.unavailable = problems.unavailable
    parts.push('some items are no longer on the menu')
  }

  if (problems.notBoxEligible.length > 0) {
    details.notBoxEligible = problems.notBoxEligible
    parts.push(`${problems.notBoxEligible.join(', ')} cannot go in a box`)
  }

  if (problems.outOfStock.length > 0) {
    details.outOfStock = problems.outOfStock
    parts.push(`${problems.outOfStock.join(', ')} sold out at ${branch.name}`)
  }

  if (parts.length === 0) return

  details.branchCode = branch.code

  throw new ApiError(409, 'ITEMS_UNAVAILABLE', capitalise(parts.join('; ')), details)
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Prices a cart against a branch. Throws ApiError on anything that makes the cart
 * unorderable; returns the full breakdown otherwise.
 *
 * @param items        validated request lines — `{ kind, productId, qty }` or
 *                     `{ kind: 'box', boxSize, productIds[] }`. Never a price.
 * @param fulfilment   'delivery' | 'pickup'
 * @param branch       a Branch DOCUMENT (its hours methods are called)
 * @param productsById Map<string, Product> — loaded fresh, already filtered to isActive
 * @param isInStock    (productId) => boolean, for THIS branch
 * @param now          injected so the hours gate is testable at any minute
 */
export function priceCart({
  items,
  fulfilment,
  branch,
  productsById,
  isInStock,
  now = new Date(),
}) {
  assertBranchCanAccept(branch, fulfilment, now)

  const problems = { unavailable: [], outOfStock: [], notBoxEligible: [] }
  const context = { productsById, isInStock, problems }

  const lines = items
    .map((item, index) =>
      item.kind === 'box'
        ? buildBoxLine(item, { ...context, index })
        : buildProductLine(item, context)
    )
    .filter(Boolean)

  // Before totalling: a subtotal computed from a cart that lost half its lines is a
  // number nobody asked for.
  throwIfUnsatisfiable(problems, branch)

  const subtotal = sum(lines.map((line) => line.lineTotal))

  // Minimum applies to the subtotal only — adding the delivery fee to reach it would mean
  // charging someone Rs 100 to qualify for the Rs 500 they were told to spend.
  if (subtotal < MIN_ORDER_VALUE) {
    throw new ApiError(
      409,
      'MINIMUM_ORDER_NOT_MET',
      `Minimum order is Rs ${MIN_ORDER_VALUE / 100}`,
      {
        subtotal,
        minimumOrderValue: MIN_ORDER_VALUE,
        shortfall: MIN_ORDER_VALUE - subtotal,
      }
    )
  }

  const deliveryFee = fulfilment === FULFILMENT.DELIVERY ? DELIVERY_FEE : 0
  const tax = sum(lines.map((line) => line.taxAmount))
  const discount = 0
  const grandTotal = subtotal + deliveryFee - discount

  return {
    currency: CURRENCY,
    fulfilment,
    branch,
    items: lines,
    totals: { subtotal, deliveryFee, discount, tax, grandTotal },
    promisedAt: new Date(now.getTime() + PROMISED_MINUTES * MS_PER_MINUTE),
    pricedAt: now,
  }
}
