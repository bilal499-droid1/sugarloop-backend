// Business rules agreed in BACKEND-DESIGN.md. Kept in one file so a rule change is
// a one-line diff with a reviewable history, not a hunt through controllers.
//
// The currency is PKR. Amounts are stored as whole hundredths of a rupee — Rs 299 is
// 29900 — never as floats, because 0.1 + 0.2 !== 0.3 and a rounding error in a price is
// a rounding error in someone's bill. See utils/money.js.

export const CURRENCY = 'PKR'

/** Rs 500 minimum order value, global (not per branch). */
export const MIN_ORDER_VALUE = 50_000

/** Rs 100 flat delivery fee. Pickup is free. */
export const DELIVERY_FEE = 10_000

/** Delivery radius from a branch. Overridable per branch on the Branch document. */
export const DEFAULT_DELIVERY_RADIUS_KM = 2

/** Stop accepting orders this many minutes before a branch closes. */
export const DEFAULT_LAST_ORDER_BUFFER_MINUTES = 30

/** Every business rule — opening hours, cutoffs, order numbers — resolves in this zone. */
export const BUSINESS_TIMEZONE = 'Asia/Karachi'

/** Quoted lead time shown to the customer: cook + travel. */
export const PROMISED_MINUTES = 45

export const FULFILMENT = Object.freeze({
  DELIVERY: 'delivery',
  PICKUP: 'pickup',
})

export const ORDER_STATUS = Object.freeze({
  PLACED: 'placed',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  READY_FOR_PICKUP: 'ready_for_pickup',
  COMPLETED: 'completed',
  FAILED: 'failed',
})

/** Terminal states — nothing transitions out of these. */
export const TERMINAL_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.FAILED,
])

/**
 * Why an order ended as `failed`. Fixed codes rather than free text so the counts are
 * reportable: a spike in `no_answer` means OTP isn't filtering prank orders well enough.
 */
export const FAILURE_REASON = Object.freeze({
  NO_ANSWER: 'no_answer',
  UNREACHABLE: 'unreachable',
  BAD_ADDRESS: 'bad_address',
  REFUSED_SUBSTITUTE: 'refused_substitute',
  CUSTOMER_REQUEST: 'customer_request',
  BRANCH_UNABLE: 'branch_unable',
  OTHER: 'other',
})

export const PAYMENT_METHOD = Object.freeze({
  COD: 'cod',
})

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  COLLECTED: 'collected',
})

export const STAFF_ROLE = Object.freeze({
  ADMIN: 'admin',
  BRANCH_MANAGER: 'branch_manager',
})

export const PRODUCT_CATEGORIES = Object.freeze([
  'Donuts',
  'Croissants',
  'Sandwiches',
  'Drinks',
])

/** Build Your Box: a box of size N holds exactly N items. */
export const BOX_SIZES = Object.freeze([2, 4, 6, 12])

/**
 * FBR is not integrated in Phase 1, but every order carries the fiscal shape so
 * switching it on later is a config change rather than a data migration. See §9b.
 */
export const FISCAL_STATUS = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  FAILED: 'failed',
})
