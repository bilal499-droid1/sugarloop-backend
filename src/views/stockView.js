/**
 * Response shape for the stock sheet.
 *
 * Reuses `productView` rather than re-listing product fields, so an item on this screen
 * carries the same shape it does on the public menu — and so the fields that view
 * deliberately withholds (Cloudinary handles, dormant FBR columns) stay withheld here
 * too. A second hand-rolled product shape is a second place to leak from.
 */
import { productView } from './productView.js'

/**
 * @param entry  `{ product, inStock, updatedAt, updatedBy }` from stock.service.js
 */
export function stockItemView({ product, inStock, updatedAt, updatedBy }) {
  return {
    ...productView(product, { inStock }),

    /**
     * Null means no row exists yet — the product has never been toggled at this branch
     * and is in stock by default. A dashboard reads that differently from "set in stock
     * at 09:12 this morning", so the distinction is published rather than flattened.
     */
    stockUpdatedAt: updatedAt ?? null,
    stockUpdatedBy: updatedBy ? String(updatedBy) : null,
  }
}

export function stockListView(items) {
  return items.map(stockItemView)
}
