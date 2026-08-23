/**
 * Response shape for a catalogue product.
 *
 * What this file deliberately does NOT emit, and why:
 *
 * - `images[].publicId` — Cloudinary's handle for the asset. It is the argument to a
 *   destroy call. Public pages need the URL, never the handle.
 * - `pctCode`, `taxRatePercent`, `priceIncludesTax` — dormant FBR fields (design §9b).
 *   Publishing a tax rate of 0 invites a frontend to start doing tax arithmetic against
 *   a field we are not ready to stand behind.
 * - `sortOrder`, `isActive`, `createdAt`, `updatedAt` — internal merchandising and
 *   bookkeeping. The list arrives already sorted; the client does not re-derive it.
 *
 * `price` is PKR in the stored form used everywhere in this system — Rs 299 is 29900.
 * `priceFormatted` is published alongside it so nothing on the client is tempted to
 * divide by 100 and start rounding.
 */

function imageView(image) {
  return {
    url: image.url,
    alt: image.alt || '',
    order: image.order ?? 0,
  }
}

/**
 * @param product        a Product document
 * @param options.inStock  availability at the branch the caller asked about. Omitted from
 *                         the payload entirely when undefined — see catalogue.service.js
 *                         for why an absent field beats a guessed one.
 */
export function productView(product, { inStock } = {}) {
  const view = {
    id: String(product._id),
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    category: product.category,
    type: product.type,

    price: product.price,
    priceFormatted: product.priceFormatted,

    description: product.description,
    allergens: product.allergens ?? [],
    images: (product.images ?? []).map(imageView),

    boxEligible: product.boxEligible,
    isFeatured: product.isFeatured,
  }

  // The numeric id the live site keys its localStorage carts by (kickoff §2). Present
  // only on seeded products; admin-created ones have none. Droppable once the frontend
  // has cut over and old carts have expired.
  if (product.legacyId != null) view.legacyId = product.legacyId

  if (inStock !== undefined) view.inStock = inStock

  return view
}

/**
 * @param stockOf  `(productId) => boolean`, or null when no branch was named.
 */
export function productListView(products, stockOf = null) {
  return products.map((product) =>
    productView(product, { inStock: stockOf ? stockOf(product._id) : undefined })
  )
}

/**
 * The same product as an admin managing the catalogue sees it.
 *
 * Deliberately wider than `productView`, because the public view hides exactly the
 * fields this screen exists to edit: `sortOrder` is merchandising, `isActive` is whether
 * the item is on the menu at all, and both are meaningless to a customer and essential
 * to whoever is arranging the list.
 *
 * Still withheld, even here:
 *
 * - `images[].publicId` — Cloudinary's handle, and the argument to a destroy call.
 *   Nothing in the console deletes an asset yet; it can be added when the upload
 *   pipeline lands, rather than published now on the chance it becomes useful.
 * - `pctCode`, `taxRatePercent`, `priceIncludesTax` — dormant FBR fields (design §9b).
 *   Nothing may edit them until the integration is real, and showing an editable-looking
 *   tax rate of 0 is an invitation to change it.
 *
 * `price` stays in stored form — Rs 299 is 29900 — with `priceFormatted` alongside, so
 * the client renders the string and submits the integer and never divides by 100.
 */
export function staffProductView(product) {
  const view = {
    id: String(product._id),
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    category: product.category,
    type: product.type,

    price: product.price,
    priceFormatted: product.priceFormatted,

    description: product.description,
    allergens: product.allergens ?? [],
    images: (product.images ?? []).map(imageView),

    boxEligible: product.boxEligible,
    isFeatured: product.isFeatured,
    sortOrder: product.sortOrder,
    isActive: product.isActive,

    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }

  if (product.legacyId != null) view.legacyId = product.legacyId

  return view
}

export function staffProductListView(products) {
  return products.map(staffProductView)
}
