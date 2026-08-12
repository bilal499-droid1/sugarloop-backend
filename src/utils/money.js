// Money in this codebase is PKR. There is one currency and it is PKR.
//
// It is STORED as a whole number of hundredths of a rupee: Rs 299 is `29900`. That is a
// storage format, not a second currency — the same way card processors store USD as an
// integer count of cents. Nothing is ever priced, displayed or charged in anything but
// rupees, and `formatPKR` is what turns a stored number back into "Rs 299".
//
// Why not just store rupees:
//
//   - Floats drift. 0.1 + 0.2 === 0.30000000000000004, and a total built that way
//     eventually disagrees with the sum of its own lines.
//   - Sub-rupee amounts are real once tax applies. 18% of Rs 299 is Rs 45.61 of tax on a
//     Rs 253.39 net. Rounding each line to whole rupees loses several rupees across a
//     large order — and FBR reports per line item, so that is a filing discrepancy.
//
// Integers are exact, and JS integers stay exact far beyond any plausible order value.

/** Rs 299 -> 29900. Rounds, because Rs 29.995 is not a real price. */
export function toStoredAmount(rupees) {
  if (!Number.isFinite(rupees)) throw new TypeError('toStoredAmount expects a finite number')
  return Math.round(rupees * 100)
}

/** 29900 -> 299. For display only — never feed this back into arithmetic. */
export function toRupees(amount) {
  assertStoredAmount(amount)
  return amount / 100
}

/** "Rs 299" / "Rs 1,250.50" — whole rupees drop the decimals, as the menu does. */
export function formatPKR(amount) {
  assertStoredAmount(amount)
  const rupees = amount / 100
  const hasFraction = amount % 100 !== 0
  return `Rs ${rupees.toLocaleString('en-PK', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** Sum of stored amounts, validated. */
export function sum(amounts) {
  return amounts.reduce((total, amount) => {
    assertStoredAmount(amount)
    return total + amount
  }, 0)
}

/** unitPrice x qty, validated on both sides. */
export function multiply(unitPrice, quantity) {
  assertStoredAmount(unitPrice)
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new TypeError(`Quantity must be a non-negative integer, got ${quantity}`)
  }
  return unitPrice * quantity
}

/**
 * Percentage of an amount, rounded half-up to the smallest stored unit.
 * Unused at 0% tax today, but this is the function tax and discounts will call.
 */
export function percentOf(amount, percent) {
  assertStoredAmount(amount)
  if (!Number.isFinite(percent) || percent < 0) {
    throw new TypeError(`Percent must be a non-negative number, got ${percent}`)
  }
  return Math.round((amount * percent) / 100)
}

function assertStoredAmount(value) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Money must be a whole stored amount, e.g. 29900 for Rs 299, got ${value}`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money value is outside the safe integer range: ${value}`)
  }
}
