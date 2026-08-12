/**
 * Response shape for a priced cart.
 *
 * Every amount is integer paisa, with a formatted twin so nothing on the client is
 * tempted to divide by 100 and start rounding. The client DISPLAYS these numbers; it
 * never computes them — that is the whole point of the pricing engine.
 */
import { formatPKR } from '../utils/money.js'

const money = (paisa) => ({ amount: paisa, formatted: formatPKR(paisa) })

function lineView(line) {
  const view = {
    kind: line.kind,
    name: line.name,
    qty: line.qty,
    unitPrice: money(line.unitPrice),
    lineTotal: money(line.lineTotal),

    // The FBR-shaped split, at 0% today (design §9b). Published because the frontend
    // shows it on an invoice the moment tax is switched on.
    tax: { rate: line.taxRate, amount: line.taxAmount },
  }

  if (line.kind === 'box') {
    view.boxSize = line.boxSize
    // Itemised even though the kitchen ticket prints one box — a reorder is impossible
    // without knowing what was in it.
    view.children = line.children.map((child) => ({
      productId: child.productId,
      sku: child.sku,
      name: child.name,
      unitPrice: money(child.unitPrice),
    }))
  } else {
    view.productId = line.productId
    view.sku = line.sku
  }

  return view
}

export function quoteView(quote) {
  const { branch, totals } = quote

  return {
    currency: quote.currency,
    fulfilment: quote.fulfilment,

    branch: {
      id: String(branch._id),
      code: branch.code,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      // Present for delivery, absent for pickup — the customer came to the shop.
      ...(branch.distanceKm !== undefined ? { distanceKm: branch.distanceKm } : {}),
    },

    items: quote.items.map(lineView),

    totals: {
      subtotal: money(totals.subtotal),
      deliveryFee: money(totals.deliveryFee),
      discount: money(totals.discount),
      tax: money(totals.tax),
      grandTotal: money(totals.grandTotal),
    },

    /** Quoted lead time — cook plus travel. */
    promisedAt: quote.promisedAt,

    /**
     * Minutes left before this branch stops taking orders, so the cart can count down
     * rather than reject someone at 02:31 without warning (design §5).
     */
    minutesUntilLastOrder: branch.minutesUntilLastOrder(quote.pricedAt),
  }
}
