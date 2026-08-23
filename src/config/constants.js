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
 * The happy path, one step at a time. `services/orderStatus.js` is what reads it.
 *
 * Two things are deliberately NOT in this table:
 *
 * - **`failed`.** It is reachable from every non-terminal state, so listing it seven
 *   times would be seven places to forget it. The state machine appends it instead.
 * - **The choice between `out_for_delivery` and `ready_for_pickup`.** Both are listed
 *   under `preparing`, but only one is legal for a given order — a pickup order that
 *   goes `out_for_delivery` sends a rider to an address that does not exist on it. The
 *   fulfilment filter lives in the state machine, next to the rest of the rules.
 *
 * No backward transitions. `statusHistory` is append-only and this is a record of what
 * happened, not a form to correct — a mis-click is fixed by a note, not by rewriting the
 * order's past. Skipping ahead is barred for the same reason.
 */
export const ORDER_STATUS_FLOW = Object.freeze({
  [ORDER_STATUS.PLACED]: Object.freeze([ORDER_STATUS.CONFIRMED]),
  [ORDER_STATUS.CONFIRMED]: Object.freeze([ORDER_STATUS.PREPARING]),
  [ORDER_STATUS.PREPARING]: Object.freeze([
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.READY_FOR_PICKUP,
  ]),
  [ORDER_STATUS.OUT_FOR_DELIVERY]: Object.freeze([ORDER_STATUS.COMPLETED]),
  [ORDER_STATUS.READY_FOR_PICKUP]: Object.freeze([ORDER_STATUS.COMPLETED]),
  [ORDER_STATUS.COMPLETED]: Object.freeze([]),
  [ORDER_STATUS.FAILED]: Object.freeze([]),
})

/** The handover step, which differs by fulfilment. See ORDER_STATUS_FLOW. */
export const HANDOVER_STATUSES = Object.freeze({
  [FULFILMENT.DELIVERY]: ORDER_STATUS.OUT_FOR_DELIVERY,
  [FULFILMENT.PICKUP]: ORDER_STATUS.READY_FOR_PICKUP,
})

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

/**
 * Phone verification (BACKEND-DESIGN §6).
 *
 * These numbers stand between the client and a bill they did not expect. Every OTP costs
 * real money in WhatsApp or SMS fees, and every unverified order is a rider sent to an
 * address nobody confirmed. The per-phone limit is the one that protects the bill — an
 * attacker rotating IPs still cannot make one number ring more than this. The per-IP
 * layer lives in middleware/rateLimit.js.
 */
export const OTP = Object.freeze({
  /** Six digits: hopeless to guess inside the attempt limit, easy to read off a
   *  notification and type without a mistake. */
  LENGTH: 6,

  /** Minutes a code stays valid. Also drives the TTL index on the collection. */
  TTL_MINUTES: 5,

  /** Wrong guesses before the challenge is burned and a fresh code must be requested. */
  MAX_ATTEMPTS: 5,

  /** Codes per phone per hour. */
  MAX_PER_PHONE_PER_HOUR: 3,

  /** Seconds before "resend" does anything, so a double-tap does not spend two messages. */
  RESEND_COOLDOWN_SECONDS: 60,
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
 * Corporate gifting leads. Three states, because a sales pipeline with more stages than
 * the shop actually works is a dropdown nobody keeps accurate.
 */
export const ENQUIRY_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  CLOSED: 'closed',
})

/**
 * What kind of thing came in through a public form.
 *
 * Both land in the same collection and the same inbox because they are the same shape —
 * somebody asked something, somebody has to answer, and the answering has to be tracked.
 * A second collection would mean a second screen, a second notification path and a second
 * place to forget to look.
 *
 * They are told apart because the work is different: `corporate` is a sales lead worth
 * chasing, `question` is a customer waiting on an answer. Mixing them silently would let
 * a 200-box enquiry sit behind a fortnight of questions about nut allergies.
 */
export const ENQUIRY_KIND = Object.freeze({
  CORPORATE: 'corporate',
  QUESTION: 'question',
})

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
