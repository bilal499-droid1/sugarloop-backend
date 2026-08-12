/**
 * Response shapes for an order — two of them, and the split is the point.
 *
 * A raw order document carries `meta.ip`, `meta.userAgent`, a `statusHistory` naming the
 * staff member behind every transition, and dormant fiscal fields. None of that belongs in
 * a customer's confirmation screen. This file is the only thing standing between those
 * fields and a client, which is why the design calls the views layer non-optional: handing
 * a controller a raw document and trusting it to remember is the most common way a JSON
 * API leaks.
 *
 *   orderView.customer(order)  what the person who placed it may see
 *   orderView.staff(order)     what the branch working it needs
 */
import { formatPKR } from '../utils/money.js'

const money = (amount) => ({ amount, formatted: formatPKR(amount) })

function itemView(item) {
  const view = {
    kind: item.kind,
    name: item.name,
    qty: item.qty,
    unitPrice: money(item.unitPrice),
    lineTotal: money(item.lineTotal),
  }

  if (item.kind === 'box') {
    view.boxSize = item.boxSize
    // The kitchen ticket prints one box; the data itemises it, or a reorder is impossible.
    view.children = (item.children ?? []).map((child) => ({
      name: child.name,
      sku: child.sku,
      unitPrice: money(child.unitPrice),
    }))
  } else {
    view.sku = item.sku
    view.productId = item.productId ? String(item.productId) : null
  }

  return view
}

function totalsView(totals) {
  return {
    subtotal: money(totals.subtotal),
    deliveryFee: money(totals.deliveryFee),
    discount: money(totals.discount),
    tax: money(totals.tax),
    grandTotal: money(totals.grandTotal),
  }
}

/**
 * The branch, whether it arrived populated, as a raw id, or attached by the service.
 * Callers should not have to know which.
 */
function branchView(order) {
  const branch = order.$branch ?? order.branchId

  if (branch && typeof branch === 'object' && branch.code) {
    return {
      code: branch.code,
      name: branch.name,
      address: branch.address,
      // Published deliberately: every notification ends with "call us on this number",
      // and a customer chasing an order needs it on the confirmation screen.
      phone: branch.phone,
    }
  }

  return { code: order.branchCode }
}

/** What the person who placed the order may see. */
function customer(order) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.createdAt,
    promisedAt: order.promisedAt,

    fulfilment: order.fulfilment,
    branch: branchView(order),

    contact: {
      name: order.contact.name,
      phone: order.contact.phone,
    },

    address: order.address
      ? {
          line1: order.address.line1,
          area: order.address.area,
          city: order.address.city,
          notes: order.address.notes,
        }
      : null,

    items: order.items.map(itemView),
    totals: totalsView(order.totals),

    payment: { method: order.payment.method, status: order.payment.status },

    /** Set only on a failed order — the customer is owed the reason. */
    failureReason: order.failureReason ?? null,

    // Deliberately absent: meta.ip, meta.userAgent, statusHistory with actor ids,
    // customerId, fiscal, distanceKm, and the branch's internal id.
  }
}

/** What the branch working the order needs — everything the customer sees, plus context. */
function staff(order) {
  return {
    ...customer(order),

    id: String(order._id),
    branchId: String(order.$branch?._id ?? order.branchId?._id ?? order.branchId),

    /** The rider needs coordinates, not just a street name. */
    address: order.address
      ? {
          line1: order.address.line1,
          area: order.address.area,
          city: order.address.city,
          notes: order.address.notes,
          location: {
            lat: order.address.location?.coordinates?.[1] ?? null,
            lng: order.address.location?.coordinates?.[0] ?? null,
          },
        }
      : null,

    distanceKm: order.distanceKm,

    contact: {
      name: order.contact.name,
      phone: order.contact.phone,
      email: order.contact.email ?? null,
    },

    /** Who moved this order, when, and why. The trail for a cash business. */
    statusHistory: order.statusHistory.map((event) => ({
      status: event.status,
      at: event.at,
      by: typeof event.by === 'string' ? event.by : String(event.by),
      note: event.note ?? null,
      reason: event.reason ?? null,
    })),

    fiscal: { status: order.fiscal?.status ?? 'not_applicable' },

    // meta stays internal even here. Nothing on a dashboard needs a customer's IP; it is
    // for an admin investigating fraud, through the database, with a reason to look.
  }
}

export const orderView = {
  customer,
  staff,
  customerList: (orders) => orders.map(customer),
  staffList: (orders) => orders.map(staff),
}
