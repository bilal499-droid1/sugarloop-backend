/**
 * Response shape for a branch.
 *
 * The opening state is computed HERE, server-side, on every request. The frontend must
 * never decide whether the shop is open: a browser clock is wrong, in the wrong timezone,
 * or deliberately changed, and "is Sugarloop taking orders" is a rule the server enforces
 * at checkout anyway (design §5). Shipping `hours` without the verdict invites the client
 * to compute its own and disagree.
 *
 * `location` is re-shaped from GeoJSON `[longitude, latitude]` to named `{ lat, lng }`.
 * The array order is backwards from every map UI and is, per the Branch model's own
 * comment, the single most common way to end up delivering from the Arabian Sea. Named
 * keys make it impossible to get wrong on the way out.
 */

export function branchView(branch, { at = new Date() } = {}) {
  const [longitude, latitude] = branch.location?.coordinates ?? [null, null]

  const isOpenNow = branch.isOpenAt(at)
  const isAcceptingOrders = branch.isAcceptingOrdersAt(at)

  return {
    id: String(branch._id),
    code: branch.code,
    name: branch.name,
    address: branch.address,
    city: branch.city,
    phone: branch.phone,

    location: { lat: latitude, lng: longitude },

    hours: { open: branch.hours.open, close: branch.hours.close },
    deliveryRadiusKm: branch.deliveryRadiusKm,
    fulfilment: branch.fulfilment,

    /** Trading — staff are in, existing orders are being worked. */
    isOpenNow,

    /**
     * Trading AND inside the last-order cutoff AND not paused by the manager. This is the
     * one the checkout button follows; `isOpenNow` alone would let a customer order at
     * 02:45 into a kitchen that has stopped taking work.
     */
    isAcceptingOrders,

    /** Drives the "last orders in X minutes" countdown. Null when not taking orders. */
    minutesUntilLastOrder: branch.minutesUntilLastOrder(at),

    /** What a "Closed — opens at 11am" message quotes. Always a real future instant. */
    nextOpeningAt: branch.nextOpeningAt(at),
  }
}

export function branchListView(branches, options) {
  return branches.map((branch) => branchView(branch, options))
}

/**
 * A branch as staff need to see it: the public shape plus the two raw switches.
 *
 * `isAcceptingOrders` above is a VERDICT — open, inside the cutoff, and not paused. That
 * is the right answer for a customer and the wrong one for the manager holding the
 * switch, because at 4am it reads false whether or not anybody paused anything. The
 * console needs to render the switch itself, so both go out and neither is inferred from
 * the other.
 */
export function staffBranchView(branch, options) {
  return {
    ...branchView(branch, options),
    isActive: branch.isActive,
    acceptingOrders: branch.acceptingOrders,
  }
}

export function staffBranchListView(branches, options) {
  return branches.map((branch) => staffBranchView(branch, options))
}
