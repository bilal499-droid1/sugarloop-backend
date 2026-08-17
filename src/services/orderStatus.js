/**
 * The order state machine, as pure functions.
 *
 * Deliberately knows nothing about Mongoose, HTTP or the database — it takes the two
 * fields that decide a transition (`status`, `fulfilment`) and answers whether a move is
 * legal. That is what lets `orderStatus.test.js` exercise every edge of the diagram
 * without a Mongo instance, and what will let Sprint 2's BullMQ timers advance an order
 * through exactly the same rules a human goes through rather than a second copy of them.
 *
 * The diagram it encodes (BACKEND-INPUTS §6):
 *
 *   placed → confirmed → preparing → out_for_delivery ┐
 *                                  → ready_for_pickup ┘→ completed
 *   any non-terminal ─────────────────────────────────→ failed  (staff only, needs a reason)
 */
import {
  FAILURE_REASON,
  HANDOVER_STATUSES,
  ORDER_STATUS,
  ORDER_STATUS_FLOW,
  TERMINAL_ORDER_STATUSES,
} from '../config/constants.js'
import { ApiError } from '../utils/ApiError.js'

/** The set of `out_for_delivery` / `ready_for_pickup`, whichever an order is not entitled to. */
const HANDOVER_SET = new Set(Object.values(HANDOVER_STATUSES))

export function isTerminal(status) {
  return TERMINAL_ORDER_STATUSES.includes(status)
}

/**
 * Every status this order may legally move to next.
 *
 * Also the answer the dashboard needs: the board renders one button per entry, so a
 * pickup order never shows an "Out for delivery" button that the server would refuse.
 * Returning the list rather than only validating against it is what keeps the two in
 * step — there is one source for what is possible, not a UI guess plus a server check.
 */
export function allowedTransitions({ status, fulfilment }) {
  if (isTerminal(status)) return []

  const handover = HANDOVER_STATUSES[fulfilment]

  const next = (ORDER_STATUS_FLOW[status] ?? []).filter(
    (candidate) => !HANDOVER_SET.has(candidate) || candidate === handover
  )

  // Appended rather than listed in the table — see the comment on ORDER_STATUS_FLOW.
  return [...next, ORDER_STATUS.FAILED]
}

/**
 * `failed` is the only status that carries a reason, and it must carry one.
 *
 * Enforced here as well as in the validator on purpose. The validator rejects a bad
 * request; this rejects a bad CALL, including the ones that will come from a job worker
 * with no HTTP layer in front of it. A `failed` order with no reason is invisible in the
 * monthly count by reason code, which is the entire point of having fixed codes.
 */
function assertReason(next, { reason, note }) {
  if (next !== ORDER_STATUS.FAILED) {
    if (reason) {
      throw ApiError.validation('A reason may only be given when failing an order', [
        { field: 'reason', message: `Not applicable to '${next}'` },
      ])
    }
    return
  }

  if (!reason) {
    throw ApiError.validation('Failing an order requires a reason', [
      { field: 'reason', message: `One of: ${Object.values(FAILURE_REASON).join(', ')}` },
    ])
  }

  // 'other' is the escape hatch, and an escape hatch with no explanation is just a
  // missing reason code that passed validation. Whoever reads the report in three
  // months cannot ask the rider what happened.
  if (reason === FAILURE_REASON.OTHER && !note) {
    throw ApiError.validation("Reason 'other' requires a note explaining what happened", [
      { field: 'note', message: 'Required when reason is other' },
    ])
  }
}

/**
 * Throws unless `order` may move to `next`.
 *
 * @param order  anything carrying `status` and `fulfilment` — a document or a plain object
 * @param next   the requested status
 * @param body   `{ reason, note }` as supplied by the caller
 */
export function assertTransition(order, next, { reason = null, note = null } = {}) {
  const from = order.status

  if (from === next) {
    // Usually a double-click or a board that polled stale data, not an attack. Told
    // apart from a genuinely illegal move because the operator's fix differs: refresh,
    // versus "this order is not yours to move yet".
    throw ApiError.conflict(`This order is already '${from}'`, { from, to: next })
  }

  if (isTerminal(from)) {
    throw ApiError.conflict(`A '${from}' order is finished and cannot be moved`, {
      from,
      to: next,
      allowed: [],
    })
  }

  const allowed = allowedTransitions(order)

  if (!allowed.includes(next)) {
    throw ApiError.conflict(`An order cannot go from '${from}' to '${next}'`, {
      from,
      to: next,
      allowed,
      // Named explicitly because it is the non-obvious half of the rule: the move is
      // refused for a pickup order that would otherwise be perfectly legal.
      fulfilment: order.fulfilment,
    })
  }

  assertReason(next, { reason, note })
}
