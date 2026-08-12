/**
 * The Sugarloop catalogue — 43 items, transcribed from the frontend's `productsData.js`.
 *
 * This is seed INPUT, not runtime data. Once `npm run seed` has run, the `products`
 * collection is the source of truth and this file is only re-read when the menu changes.
 * Nothing in the API imports it.
 *
 * Shape notes, and why they differ from the frontend file:
 *
 * - `price` is in RUPEES here and converted to the stored form by the seed (Rs 299 becomes
 *   29900). The table stays readable and there is one place the conversion can go wrong.
 * - `sku` and `slug` are added — both are required and unique on the Product model. SKU
 *   is what a kitchen ticket prints and what Nimbus POS maps against in Phase 2; slug is
 *   the public URL (`/products/:slug`), which replaces the numeric frontend id.
 * - `sourceImages` holds the frontend's Vite asset identifiers. They are NOT usable by the
 *   backend — `Product.images` needs Cloudinary `{ url, publicId }` pairs, which is
 *   blocked on the account migration in plan §10. They are kept as plain strings so that
 *   when the images are uploaded, the product-to-image mapping does not have to be
 *   reconstructed by hand for 43 items.
 * - `legacyId` is the frontend's numeric id and IS persisted (kickoff §2): the live site
 *   keys its localStorage carts by it, so without the mapping every open cart breaks on
 *   cutover. Nothing in the API identifies a product this way — that is `slug`.
 * - `sku` follows the kickoff §2 scheme: category prefix + slug, prefixes DON / CRO / SAN
 *   / DRK. This is what Nimbus POS maps against in Phase 2, so it must not drift.
 * - `size: 'sm'` from the frontend is dropped. It was uniform across all 43 items and the
 *   design has no variants or modifiers.
 *
 * ⚠️ Open items this data does not resolve (plan §16, §17):
 * - Every food item shares one generic description and every drink shares another. Real
 *   copy is still owed by the client.
 * - No allergen, ingredient or calorie data. Whether the site needs it is unanswered.
 * - Frontend ids 7, 11, 23 and 26 are absent. Plan §17 asks whether those are deliberate
 *   removals or an incomplete menu; still unconfirmed, so 43 items is what we seed.
 */

const DESCRIPTION =
  'Baked fresh every morning with simple, honest ingredients. Best enjoyed the same day, alongside your favorite coffee.'

const DRINK_DESCRIPTION =
  'Made to order with freshly pulled espresso and whole milk. Tell us if you would like it lighter, sweeter, or extra cold.'

/**
 * Build Your Box holds food, not drinks: a box of N contains exactly N items priced as
 * the sum of its contents, and categories may mix (plan §11 — donuts and croissants in
 * one box is explicitly allowed, Crafted Donuts are eligible). Sandwiches and drinks are
 * excluded because a milkshake in a gift box of donuts is a leak, not a feature.
 *
 * If the client wants sandwiches boxable later, it is one flag per row here plus a
 * re-seed — no schema change.
 */

export const CATALOGUE = [
  // ---- Donuts / Signature (Rs 299) -----------------------------------------
  { legacyId: 1,  sku: 'DON-CHOCOHOLIC',          slug: 'chocoholic',          name: 'Chocoholic',           price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 10,  description: DESCRIPTION, sourceImages: ['chocoholic1', 'chocoholic2', 'chocoholic3'] },
  { legacyId: 2,  sku: 'DON-LOTUS',               slug: 'lotus',               name: 'Lotus',                price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 20,  description: DESCRIPTION, sourceImages: ['lotus1', 'lotus2', 'lotus3'] },
  { legacyId: 3,  sku: 'DON-NUTELLA',             slug: 'nutella',             name: 'Nutella',              price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 30,  description: DESCRIPTION, sourceImages: ['nutella1', 'nutella2', 'nutella3'] },
  // Slug is 'coffee-donut', not 'coffee' — a bare /products/coffee in a menu that also
  // sells five coffees reads as a mistake, and the slug is a permanent public URL.
  { legacyId: 4,  sku: 'DON-COFFEE-DONUT',              slug: 'coffee-donut',        name: 'Coffee',               price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 40,  description: DESCRIPTION, sourceImages: ['coffeeDonut1', 'coffeeDonut2', 'coffeeDonut3'] },
  { legacyId: 5,  sku: 'DON-SALTED-CARAMEL',      slug: 'salted-caramel',      name: 'Salted Caramel',       price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 50,  description: DESCRIPTION, sourceImages: ['saltedCaramel1', 'saltedCaramel2', 'saltedCaramel3'] },
  { legacyId: 6,  sku: 'DON-BOSTON-CREME',        slug: 'boston-creme',        name: 'Boston Creme',         price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 60,  description: DESCRIPTION, sourceImages: ['bostonCreme1', 'bostonCreme2', 'bostonCreme3'] },
  { legacyId: 8,  sku: 'DON-MIX-BERRY',           slug: 'mix-berry',           name: 'Mix Berry',            price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 70,  description: DESCRIPTION, sourceImages: ['mixBerry1', 'mixBerry2', 'mixBerry3'] },
  { legacyId: 9,  sku: 'DON-BROWNIE-FILLED',      slug: 'brownie-filled',      name: 'Brownie Filled',       price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 80,  description: DESCRIPTION, sourceImages: ['brownieFilled1', 'brownieFilled2'] },
  { legacyId: 10, sku: 'DON-MANGO',               slug: 'mango',               name: 'Mango',                price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 90,  description: DESCRIPTION, sourceImages: ['mango1', 'mango2'] },

  // ---- Donuts / Classic (Rs 185–230) ---------------------------------------
  { legacyId: 12, sku: 'DON-CLASSIC-OREO',        slug: 'classic-oreo',        name: 'Classic Oreo',         price: 185, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 100, description: DESCRIPTION, sourceImages: ['classicOreo1', 'classicOreo2'] },
  { legacyId: 13, sku: 'DON-CHOCOLATE-SPRINKLE',  slug: 'chocolate-sprinkle',  name: 'Chocolate Sprinkle',   price: 185, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 110, description: DESCRIPTION, sourceImages: ['chocolateSprinkle1', 'chocolateSprinkle2'] },
  { legacyId: 14, sku: 'DON-CLASSIC-CHOCOLATE',   slug: 'classic-chocolate',   name: 'Classic Chocolate',    price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 120, description: DESCRIPTION, sourceImages: ['classicChocolate1', 'classicChocolate2'] },
  { legacyId: 15, sku: 'DON-WHITE-CHOCOLATE',     slug: 'white-chocolate',     name: 'White Chocolate',      price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 130, description: DESCRIPTION, sourceImages: ['whiteChocolate1', 'whiteChocolate2'] },
  { legacyId: 16, sku: 'DON-CHOCOLATE-GLAZED',    slug: 'chocolate-glazed',    name: 'Chocolate Glazed',     price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 140, description: DESCRIPTION, sourceImages: ['chocolateGlazed1', 'chocolateGlazed2'] },
  { legacyId: 17, sku: 'DON-VANILLA-GLAZED',      slug: 'vanilla-glazed',      name: 'Vanilla Glazed',       price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 150, description: DESCRIPTION, sourceImages: ['vanillaGlazed1', 'vanillaGlazed2'] },

  // ---- Donuts / Crafted (Rs 429) -------------------------------------------
  { legacyId: 44, sku: 'DON-SNICKERS',            slug: 'snickers',            name: 'Snickers',             price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 160, description: DESCRIPTION, sourceImages: ['snicker1', 'snickers2'] },
  { legacyId: 45, sku: 'DON-TIRAMISU-CREME',      slug: 'tiramisu-creme',      name: 'Tiramisu Creme',       price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 170, description: DESCRIPTION, sourceImages: ['tiramisu1', 'tiramisu2', 'tiramisu3'] },
  { legacyId: 46, sku: 'DON-KINDER-CREAM',        slug: 'kinder-cream',        name: 'Kinder Cream',         price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 180, description: DESCRIPTION, sourceImages: ['kinder1', 'kinder2', 'kinder3'] },
  { legacyId: 47, sku: 'DON-KITKAT-CRUNCH',       slug: 'kitkat-crunch',       name: 'KitKat Crunch',        price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 190, description: DESCRIPTION, sourceImages: ['kitkat1', 'kitkat2', 'kitkat3'] },

  // ---- Croissants / Fresh Bakes --------------------------------------------
  { legacyId: 18, sku: 'CRO-CHOCOLATE-CROISSANT',           slug: 'chocolate-croissant', name: 'Chocolate Croissant',     price: 379, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 10, description: DESCRIPTION, sourceImages: ['chocolateCroissant1', 'chocolateCroissant2', 'chocolateCroissant3'] },
  { legacyId: 19, sku: 'CRO-BUTTER-CREAM-CROISSANT',        slug: 'butter-cream-croissant', name: 'Butter Cream Croissant', price: 370, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 20, description: DESCRIPTION, sourceImages: ['butterCreamCroissant1', 'butterCreamCroissant2'] },
  { legacyId: 20, sku: 'CRO-BUTTER-CROISSANT',              slug: 'butter-croissant',    name: 'Butter Croissant',        price: 299, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 30, description: DESCRIPTION, sourceImages: ['butterCroissant1', 'butterCroissant2'] },
  { legacyId: 21, sku: 'CRO-BAKED-CINNAMON',      slug: 'baked-cinnamon',      name: 'Baked Cinnamon',          price: 299, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 40, description: DESCRIPTION, sourceImages: ['bakedCinnamon1', 'bakedCinnamon2'] },

  // ---- Sandwiches ----------------------------------------------------------
  { legacyId: 22, sku: 'SAN-SIGNATURE-CHICKEN',   slug: 'signature-chicken',   name: 'Signature Chicken',    price: 349, category: 'Sandwiches', type: 'Sandwiches', boxEligible: false, sortOrder: 10, description: DESCRIPTION, sourceImages: ['signatureChicken1'] },
  { legacyId: 24, sku: 'SAN-SMOKED-TIKKA-MELT',   slug: 'smoked-tikka-melt',   name: 'Smoked Tikka Melt',    price: 499, category: 'Sandwiches', type: 'Sandwiches', boxEligible: false, sortOrder: 20, description: DESCRIPTION, sourceImages: ['smokedTikka1', 'smokedTikka2'] },
  { legacyId: 25, sku: 'SAN-SIZZLING-FAJITA',     slug: 'sizzling-fajita',     name: 'Sizzling Fajita',      price: 499, category: 'Sandwiches', type: 'Sandwiches', boxEligible: false, sortOrder: 30, description: DESCRIPTION, sourceImages: ['sizzlingFajita1', 'sizzlingFajita2'] },

  // ---- Drinks / Hot Coffee -------------------------------------------------
  { legacyId: 27, sku: 'DRK-CAPPUCCINO',          slug: 'cappuccino',          name: 'Cappuccino',           price: 499, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 10, description: DRINK_DESCRIPTION, sourceImages: ['cappuccinoImg'] },
  { legacyId: 28, sku: 'DRK-LATTE',               slug: 'latte',               name: 'Latte',                price: 499, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 20, description: DRINK_DESCRIPTION, sourceImages: ['latteImg'] },
  { legacyId: 29, sku: 'DRK-SPANISH-LATTE',       slug: 'spanish-latte',       name: 'Spanish Latte',        price: 599, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 30, description: DRINK_DESCRIPTION, sourceImages: ['spanishLatteImg'] },
  { legacyId: 30, sku: 'DRK-CARAMEL-LATTE',       slug: 'caramel-latte',       name: 'Caramel Latte',        price: 599, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 40, description: DRINK_DESCRIPTION, sourceImages: ['caramelLatteImg'] },

  // ---- Drinks / Iced Coffee ------------------------------------------------
  { legacyId: 31, sku: 'DRK-ICED-CAPPUCCINO',     slug: 'iced-cappuccino',     name: 'Iced Cappuccino',      price: 599, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 50, description: DRINK_DESCRIPTION, sourceImages: ['icedCappuccino2'] },
  { legacyId: 32, sku: 'DRK-ICED-LATTE',          slug: 'iced-latte',          name: 'Iced Latte',           price: 599, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 60, description: DRINK_DESCRIPTION, sourceImages: ['icedLatte1'] },
  { legacyId: 33, sku: 'DRK-ICED-SPANISH-LATTE',  slug: 'iced-spanish-latte',  name: 'Iced Spanish Latte',   price: 699, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 70, description: DRINK_DESCRIPTION, sourceImages: ['icedSpanishLatte1'] },
  { legacyId: 34, sku: 'DRK-ICED-CARAMEL-LATTE',  slug: 'iced-caramel-latte',  name: 'Iced Caramel Latte',   price: 699, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 80, description: DRINK_DESCRIPTION, sourceImages: ['icedCaramelLatte1'] },

  // ---- Drinks / Blended Iced (Rs 799) --------------------------------------
  { legacyId: 35, sku: 'DRK-CARAMEL-FRAPPE',           slug: 'caramel-frappe',           name: 'Caramel Frappe',           price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 90,  description: DRINK_DESCRIPTION, sourceImages: ['caramelFrappe1'] },
  { legacyId: 36, sku: 'DRK-COOKIES-AND-CREAM-FRAPPE',     slug: 'cookies-and-cream-frappe', name: 'Cookies & Cream Frappe',   price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 100, description: DRINK_DESCRIPTION, sourceImages: ['cookiesCreamFrappe1'] },
  { legacyId: 37, sku: 'DRK-HAZELNUT-FRAPPE',          slug: 'hazelnut-frappe',          name: 'Hazelnut Frappe',          price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 110, description: DRINK_DESCRIPTION, sourceImages: ['hazelnutFrappe1'] },
  { legacyId: 38, sku: 'DRK-DOUBLE-CHOCOLATE-FRAPPE',  slug: 'double-chocolate-frappe',  name: 'Double Chocolate Frappe',  price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 120, description: DRINK_DESCRIPTION, sourceImages: ['doubleChocolateFrappe1'] },
  { legacyId: 39, sku: 'DRK-MOCHA-FRAPPE',             slug: 'mocha-frappe',             name: 'Mocha Frappe',             price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 130, description: DRINK_DESCRIPTION, sourceImages: ['mochaFrappe1'] },

  // ---- Drinks / Chillers + Extras ------------------------------------------
  { legacyId: 40, sku: 'DRK-PASSION-FRUIT-CHILLER', slug: 'passion-fruit-chiller', name: 'Passion Fruit Chiller', price: 299, category: 'Drinks', type: 'Chillers', boxEligible: false, sortOrder: 140, description: DRINK_DESCRIPTION, sourceImages: ['passionFruit1', 'passionFruit2'] },
  { legacyId: 41, sku: 'DRK-WILD-BERRY-CHILLER',    slug: 'wild-berry-chiller',    name: 'Wild Berry Chiller',    price: 299, category: 'Drinks', type: 'Chillers', boxEligible: false, sortOrder: 150, description: DRINK_DESCRIPTION, sourceImages: ['wildBerry1', 'wildBerry2'] },
  { legacyId: 42, sku: 'DRK-STRAWBERRY-CHILLER',    slug: 'strawberry-chiller',    name: 'Strawberry Chiller',    price: 299, category: 'Drinks', type: 'Chillers', boxEligible: false, sortOrder: 160, description: DRINK_DESCRIPTION, sourceImages: ['strawberryChillerSc', 'strawberryChiller2'] },
  { legacyId: 43, sku: 'DRK-WATER',                 slug: 'water',                 name: 'Water',                 price: 120, category: 'Drinks', type: 'Extras',   boxEligible: false, sortOrder: 170, description: 'Chilled bottled water.', sourceImages: ['waterImg'] },
]

export default CATALOGUE
