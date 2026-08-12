// Money is integer paisa everywhere in this codebase. Rs 299 is 29900.
//
// Floats are not an option: 0.1 + 0.2 === 0.30000000000000004, and totals built from
// float arithmetic drift by a paisa or two, which turns into an order whose lines
// don't sum to its total. Integers are exact, and JS integers are safe far beyond
// any plausible order value.

/** Rs -> paisa. Rounds, because Rs 29.995 is not a real price. */
export function toPaisa(rupees) {
  if (!Number.isFinite(rupees)) throw new TypeError('toPaisa expects a finite number')
  return Math.round(rupees * 100)
}

/** Paisa -> Rs, as a number. For display only — never feed this back into arithmetic. */
export function toRupees(paisa) {
  assertPaisa(paisa)
  return paisa / 100
}

/** "Rs 299" / "Rs 1,250.50" — whole rupees drop the decimals, as the menu does. */
export function formatPKR(paisa) {
  assertPaisa(paisa)
  const rupees = paisa / 100
  const hasFraction = paisa % 100 !== 0
  return `Rs ${rupees.toLocaleString('en-PK', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** Sum of paisa amounts, validated. */
export function sum(amounts) {
  return amounts.reduce((total, amount) => {
    assertPaisa(amount)
    return total + amount
  }, 0)
}

/** unitPrice x qty, validated on both sides. */
export function multiply(unitPaisa, quantity) {
  assertPaisa(unitPaisa)
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new TypeError(`Quantity must be a non-negative integer, got ${quantity}`)
  }
  return unitPaisa * quantity
}

/**
 * Percentage of an amount, rounded half-up to the nearest paisa.
 * Unused at 0% tax today, but this is the function tax and discounts will call.
 */
export function percentOf(paisa, percent) {
  assertPaisa(paisa)
  if (!Number.isFinite(percent) || percent < 0) {
    throw new TypeError(`Percent must be a non-negative number, got ${percent}`)
  }
  return Math.round((paisa * percent) / 100)
}

function assertPaisa(value) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Money must be an integer number of paisa, got ${value}`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money value is outside the safe integer range: ${value}`)
  }
}
