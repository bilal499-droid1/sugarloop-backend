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
 * `price` is integer paisa, as everywhere else in the system. `priceFormatted` is there so
 * nothing on the client is tempted to divide by 100 and start rounding.
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
