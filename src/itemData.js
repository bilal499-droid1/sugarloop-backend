/**
 * The Sugarloop catalogue — 48 items, transcribed from the frontend's `productsData.js`.
 * 43 of them are the original menu; the Blueberry donut and four Brownies came later.
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
 *   reconstructed by hand for every item.
 * - `legacyId` is the frontend's numeric id and IS persisted (kickoff §2): the live site
 *   keys its localStorage carts by it, so without the mapping every open cart breaks on
 *   cutover. Nothing in the API identifies a product this way — that is `slug`.
 * - `sku` follows the kickoff §2 scheme: category prefix + slug, prefixes DON / CRO / SAN
 *   / DRK, plus BRW for the Brownies category added after the original transcription.
 *   This is what Nimbus POS maps against in Phase 2, so it must not drift.
 * - `size: 'sm'` from the frontend is dropped. It was uniform across every item and the
 *   design has no variants or modifiers.
 *
 * ⚠️ Open items this data does not resolve (plan §16, §17):
 * - Real description copy landed for every item on the board. Brownie Filled and
 *   Snickers are commented out below, not deleted: no copy was supplied for them, so
 *   they stay off the menu until it arrives. Uncomment the row and re-seed to restore
 *   one - the seed deactivates rows that leave this list, it never drops them.
 * - No allergen, ingredient or calorie data. Whether the site needs it is unanswered.
 * - Frontend ids 7, 11, 23 and 26 are absent. Plan §17 asks whether those are deliberate
 *   removals or an incomplete menu; still unconfirmed, so they stay unseeded.
 */

// The generic placeholder the whole board used to share. Only the two commented-out
// rows still reference it, so it is parked here for when they come back.
// const DESCRIPTION =
//   'Baked fresh every morning with simple, honest ingredients. Best enjoyed the same day, alongside your favorite coffee.'

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
  { legacyId: 1,  sku: 'DON-CHOCOHOLIC',          slug: 'chocoholic',          name: 'Chocoholic',           price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 10,  description: 'Molten chocolate center topped with crunchy chocolate bits.', sourceImages: ['chocoholic1', 'chocoholic2', 'chocoholic3'] },
  { legacyId: 2,  sku: 'DON-LOTUS',               slug: 'lotus',               name: 'Lotus',                price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 20,  description: 'Lotus cookie butter filling topped with a Lotus Biscoff biscuit.', sourceImages: ['lotus1', 'lotus2', 'lotus3'] },
  { legacyId: 3,  sku: 'DON-NUTELLA',             slug: 'nutella',             name: 'Nutella',              price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 30,  description: 'Filled with rich Nutella spread and topped with powdered sugar.', sourceImages: ['nutella1', 'nutella2', 'nutella3'] },
  // Slug is 'coffee-donut', not 'coffee' — a bare /products/coffee in a menu that also
  // sells five coffees reads as a mistake, and the slug is a permanent public URL.
  { legacyId: 4,  sku: 'DON-COFFEE-DONUT',              slug: 'coffee-donut',        name: 'Coffee',               price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 40,  description: 'Espresso creamy center topped with coffee infused cream.', sourceImages: ['coffeeDonut1', 'coffeeDonut2', 'coffeeDonut3'] },
  { legacyId: 5,  sku: 'DON-SALTED-CARAMEL',      slug: 'salted-caramel',      name: 'Salted Caramel',       price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 50,  description: 'Sugar doughnut with a sweet and salty caramel center.', sourceImages: ['saltedCaramel1', 'saltedCaramel2', 'saltedCaramel3'] },
  { legacyId: 6,  sku: 'DON-BOSTON-CREME',        slug: 'boston-creme',        name: 'Boston Creme',         price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 60,  description: 'Vanilla custard filling topped with rich chocolate.', sourceImages: ['bostonCreme1', 'bostonCreme2', 'bostonCreme3'] },
  { legacyId: 8,  sku: 'DON-MIX-BERRY',           slug: 'mix-berry',           name: 'Mix Berry',            price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 70,  description: 'Mixed berry cream filled in a white chocolate topped donut.', sourceImages: ['mixBerry1', 'mixBerry2', 'mixBerry3'] },
  // sortOrder 75 keeps Blueberry next to Mix Berry, where the storefront's hand-curated
  // array puts it — the seeded order is what the menu renders, so a trailing 200 would
  // have dropped it past the Crafted donuts.
  { legacyId: 48, sku: 'DON-BLUEBERRY',           slug: 'blueberry',           name: 'Blueberry',            price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 75,  description: 'Center-filled donut with a sweet and tart blueberry cream filling.', sourceImages: ['blueberry1', 'blueberry2'] },
  // { legacyId: 9,  sku: 'DON-BROWNIE-FILLED',      slug: 'brownie-filled',      name: 'Brownie Filled',       price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 80,  description: DESCRIPTION, sourceImages: ['brownieFilled1', 'brownieFilled2'] },
  { legacyId: 10, sku: 'DON-MANGO',               slug: 'mango',               name: 'Mango',                price: 299, category: 'Donuts', type: 'Signature',      boxEligible: true, sortOrder: 90,  description: 'Donut filled with sweet, tangy and fluffy mango cream, topped with sugar.', sourceImages: ['mango1', 'mango2'] },

  // ---- Donuts / Classic (Rs 185–230) ---------------------------------------
  { legacyId: 12, sku: 'DON-CLASSIC-OREO',        slug: 'classic-oreo',        name: 'Classic Oreo',         price: 185, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 100, description: 'Donut topped with chocolate glaze and crushed Oreos.', sourceImages: ['classicOreo1', 'classicOreo2'] },
  { legacyId: 13, sku: 'DON-CHOCOLATE-SPRINKLE',  slug: 'chocolate-sprinkle',  name: 'Chocolate Sprinkle',   price: 185, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 110, description: 'Classic donut with dark chocolate glaze and sprinkles.', sourceImages: ['chocolateSprinkle1', 'chocolateSprinkle2'] },
  { legacyId: 14, sku: 'DON-CLASSIC-CHOCOLATE',   slug: 'classic-chocolate',   name: 'Classic Chocolate',    price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 120, description: 'Ring doughnut coated in a chocolate glaze.', sourceImages: ['classicChocolate1', 'classicChocolate2'] },
  { legacyId: 15, sku: 'DON-WHITE-CHOCOLATE',     slug: 'white-chocolate',     name: 'White Chocolate',      price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 130, description: 'Doughnut covered in a sweet white chocolate glaze.', sourceImages: ['whiteChocolate1', 'whiteChocolate2'] },
  { legacyId: 16, sku: 'DON-CHOCOLATE-GLAZED',    slug: 'chocolate-glazed',    name: 'Chocolate Glazed',     price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 140, description: 'Donut featuring a rich chocolate coating with a decorative drizzle.', sourceImages: ['chocolateGlazed1', 'chocolateGlazed2'] },
  { legacyId: 17, sku: 'DON-VANILLA-GLAZED',      slug: 'vanilla-glazed',      name: 'Vanilla Glazed',       price: 230, category: 'Donuts', type: 'Classic',        boxEligible: true, sortOrder: 150, description: 'Traditional doughnut coated in a sweet, glossy vanilla glaze.', sourceImages: ['vanillaGlazed1', 'vanillaGlazed2'] },

  // ---- Donuts / Crafted (Rs 429) -------------------------------------------
  // { legacyId: 44, sku: 'DON-SNICKERS',            slug: 'snickers',            name: 'Snickers',             price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 160, description: DESCRIPTION, sourceImages: ['snicker1', 'snickers2'] },
  { legacyId: 45, sku: 'DON-TIRAMISU-CREME',      slug: 'tiramisu-creme',      name: 'Tiramisu Creme',       price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 170, description: 'Cocoa dusted donut with a rich coffee filling and cream topping.', sourceImages: ['tiramisu1', 'tiramisu2', 'tiramisu3'] },
  { legacyId: 46, sku: 'DON-KINDER-CREAM',        slug: 'kinder-cream',        name: 'Kinder Cream',         price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 180, description: 'Donut filled with a milky white cream filling.', sourceImages: ['kinder1', 'kinder2', 'kinder3'] },
  { legacyId: 47, sku: 'DON-KITKAT-CRUNCH',       slug: 'kitkat-crunch',       name: 'KitKat Crunch',        price: 429, category: 'Donuts', type: 'Crafted Donuts', boxEligible: true, sortOrder: 190, description: 'Molten chocolate center topped with KitKat bits and chocolate drizzle.', sourceImages: ['kitkat1', 'kitkat2', 'kitkat3'] },

  // ---- Brownies ------------------------------------------------------------
  // The fifth category, added after the original menu transcription. `BRW` extends the
  // kickoff §2 prefix scheme (DON / CRO / SAN / DRK) rather than borrowing DON, because
  // the prefix is what Nimbus POS maps against in Phase 2 and a brownie is not a donut.
  // Not box-eligible: Build Your Box is donuts and croissants (plan §11), and nobody has
  // asked for brownies in a box.
  { legacyId: 49, sku: 'BRW-CHOCOLATE-BOUNTY',    slug: 'chocolate-bounty',    name: 'Chocolate Bounty',     price: 420, category: 'Brownies', type: 'Brownies', boxEligible: false, sortOrder: 10, description: 'Rich chocolate brownie layered with sweet coconut and a tempered chocolate top.', sourceImages: ['chocolateBounty1', 'chocolateBounty2'] },
  { legacyId: 50, sku: 'BRW-PEANUT-BUTTER',       slug: 'peanut-butter',       name: 'Peanut Butter',        price: 399, category: 'Brownies', type: 'Brownies', boxEligible: false, sortOrder: 20, description: 'Fudge brownie swirled with creamy, nutty peanut butter.', sourceImages: ['peanutButter1', 'peanutButter2'] },
  { legacyId: 51, sku: 'BRW-BROOKIE',             slug: 'brookie',             name: 'Brookie',              price: 399, category: 'Brownies', type: 'Brownies', boxEligible: false, sortOrder: 30, description: 'A hybrid combining a chewy chocolate chip cookie and a rich brownie.', sourceImages: ['brookie1', 'brookie2'] },
  { legacyId: 52, sku: 'BRW-CLASSIC-FUDGE',       slug: 'classic-fudge',       name: 'Classic Fudge',        price: 370, category: 'Brownies', type: 'Brownies', boxEligible: false, sortOrder: 40, description: 'Intensely chocolatey fudge brownie with a perfectly crackly crust.', sourceImages: ['classicFudge1', 'classicFudge2'] },

  // ---- Croissants / Fresh Bakes --------------------------------------------
  { legacyId: 18, sku: 'CRO-CHOCOLATE-CROISSANT',           slug: 'chocolate-croissant', name: 'Chocolate Croissant',     price: 379, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 10, description: 'Flaky, buttery chocolate filled croissant dipped in rich chocolate.', sourceImages: ['chocolateCroissant1', 'chocolateCroissant2', 'chocolateCroissant3'] },
  { legacyId: 19, sku: 'CRO-BUTTER-CREAM-CROISSANT',        slug: 'butter-cream-croissant', name: 'Butter Cream Croissant', price: 370, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 20, description: 'Flaky pastry filled with sweet, velvety buttercream.', sourceImages: ['butterCreamCroissant1', 'butterCreamCroissant2'] },
  { legacyId: 20, sku: 'CRO-BUTTER-CROISSANT',              slug: 'butter-croissant',    name: 'Butter Croissant',        price: 299, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 30, description: 'Classic golden, flaky croissant with a rich, buttery taste.', sourceImages: ['butterCroissant1', 'butterCroissant2'] },
  { legacyId: 21, sku: 'CRO-BAKED-CINNAMON',      slug: 'baked-cinnamon',      name: 'Baked Cinnamon',          price: 299, category: 'Croissants', type: 'Fresh Bakes', boxEligible: true, sortOrder: 40, description: 'Soft, sweet pastry swirled with cinnamon and topped with a light glaze.', sourceImages: ['bakedCinnamon1', 'bakedCinnamon2'] },

  // ---- Sandwiches ----------------------------------------------------------
  { legacyId: 22, sku: 'SAN-SIGNATURE-CHICKEN',   slug: 'signature-chicken',   name: 'Signature Chicken',    price: 349, category: 'Sandwiches', type: 'Sandwiches', boxEligible: false, sortOrder: 10, description: 'Soft, classic white bread sandwich filled with creamy, seasoned chicken spread.', sourceImages: ['signatureChicken1'] },
  { legacyId: 24, sku: 'SAN-SMOKED-TIKKA-MELT',   slug: 'smoked-tikka-melt',   name: 'Smoked Tikka Melt',    price: 499, category: 'Sandwiches', type: 'Sandwiches', boxEligible: false, sortOrder: 20, description: 'Toasted, golden panini packed with smoky, spiced tikka chicken.', sourceImages: ['smokedTikka1', 'smokedTikka2'] },
  { legacyId: 25, sku: 'SAN-SIZZLING-FAJITA',     slug: 'sizzling-fajita',     name: 'Sizzling Fajita',      price: 499, category: 'Sandwiches', type: 'Sandwiches', boxEligible: false, sortOrder: 30, description: 'Grilled, crispy panini loaded with fajita chicken and fresh lettuce and cucumber.', sourceImages: ['sizzlingFajita1', 'sizzlingFajita2'] },

  // ---- Drinks / Hot Coffee -------------------------------------------------
  { legacyId: 27, sku: 'DRK-CAPPUCCINO',          slug: 'cappuccino',          name: 'Cappuccino',           price: 499, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 10, description: 'Classic hot espresso with steamed milk and rich foam.', sourceImages: ['cappuccinoImg'] },
  { legacyId: 28, sku: 'DRK-LATTE',               slug: 'latte',               name: 'Latte',                price: 499, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 20, description: 'Smooth espresso combined with velvety steamed milk and a light foam layer.', sourceImages: ['latteImg'] },
  { legacyId: 29, sku: 'DRK-SPANISH-LATTE',       slug: 'spanish-latte',       name: 'Spanish Latte',        price: 599, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 30, description: 'Rich hot espresso sweetened with condensed milk and steamed milk.', sourceImages: ['spanishLatteImg'] },
  { legacyId: 30, sku: 'DRK-CARAMEL-LATTE',       slug: 'caramel-latte',       name: 'Caramel Latte',        price: 599, category: 'Drinks', type: 'Hot Coffee',   boxEligible: false, sortOrder: 40, description: 'Latte infused with sweet caramel.', sourceImages: ['caramelLatteImg'] },

  // ---- Drinks / Iced Coffee ------------------------------------------------
  { legacyId: 31, sku: 'DRK-ICED-CAPPUCCINO',     slug: 'iced-cappuccino',     name: 'Iced Cappuccino',      price: 599, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 50, description: 'Chilled espresso drink topped with a layer of cold foam.', sourceImages: ['icedCappuccino2'] },
  { legacyId: 32, sku: 'DRK-ICED-LATTE',          slug: 'iced-latte',          name: 'Iced Latte',           price: 599, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 60, description: 'Chilled espresso poured over cold milk and ice.', sourceImages: ['icedLatte1'] },
  { legacyId: 33, sku: 'DRK-ICED-SPANISH-LATTE',  slug: 'iced-spanish-latte',  name: 'Iced Spanish Latte',   price: 699, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 70, description: 'Sweet and creamy blend of rich espresso and sweetened condensed milk over ice.', sourceImages: ['icedSpanishLatte1'] },
  { legacyId: 34, sku: 'DRK-ICED-CARAMEL-LATTE',  slug: 'iced-caramel-latte',  name: 'Iced Caramel Latte',   price: 699, category: 'Drinks', type: 'Iced Coffee',  boxEligible: false, sortOrder: 80, description: 'Chilled espresso and milk over ice with a sweet caramel drizzle.', sourceImages: ['icedCaramelLatte1'] },

  // ---- Drinks / Blended Iced (Rs 799) --------------------------------------
  { legacyId: 35, sku: 'DRK-CARAMEL-FRAPPE',           slug: 'caramel-frappe',           name: 'Caramel Frappe',           price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 90,  description: 'Blended iced coffee featuring a rich caramel flavor.', sourceImages: ['caramelFrappe1'] },
  { legacyId: 36, sku: 'DRK-COOKIES-AND-CREAM-FRAPPE',     slug: 'cookies-and-cream-frappe', name: 'Cookies & Cream Frappe',   price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 100, description: 'Frappe loaded with crushed chocolate cookies.', sourceImages: ['cookiesCreamFrappe1'] },
  { legacyId: 37, sku: 'DRK-HAZELNUT-FRAPPE',          slug: 'hazelnut-frappe',          name: 'Hazelnut Frappe',          price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 110, description: 'Blended iced coffee rich with creamy hazelnut flavor.', sourceImages: ['hazelnutFrappe1'] },
  { legacyId: 38, sku: 'DRK-DOUBLE-CHOCOLATE-FRAPPE',  slug: 'double-chocolate-frappe',  name: 'Double Chocolate Frappe',  price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 120, description: 'Blended coffee loaded with rich chocolate.', sourceImages: ['doubleChocolateFrappe1'] },
  { legacyId: 39, sku: 'DRK-MOCHA-FRAPPE',             slug: 'mocha-frappe',             name: 'Mocha Frappe',             price: 799, category: 'Drinks', type: 'Blended Iced', boxEligible: false, sortOrder: 130, description: 'Smooth iced blend of espresso and chocolate.', sourceImages: ['mochaFrappe1'] },

  // ---- Drinks / Chillers + Extras ------------------------------------------
  { legacyId: 40, sku: 'DRK-PASSION-FRUIT-CHILLER', slug: 'passion-fruit-chiller', name: 'Passion Fruit Chiller', price: 299, category: 'Drinks', type: 'Chillers', boxEligible: false, sortOrder: 140, description: 'Refreshing, ice-cold beverage bursting with tangy tropical passion fruit flavor.', sourceImages: ['passionFruit1', 'passionFruit2'] },
  { legacyId: 41, sku: 'DRK-WILD-BERRY-CHILLER',    slug: 'wild-berry-chiller',    name: 'Wild Berry Chiller',    price: 299, category: 'Drinks', type: 'Chillers', boxEligible: false, sortOrder: 150, description: 'Cool, fruity drink blended with a sweet and tart mix of wild berries.', sourceImages: ['wildBerry1', 'wildBerry2'] },
  { legacyId: 42, sku: 'DRK-STRAWBERRY-CHILLER',    slug: 'strawberry-chiller',    name: 'Strawberry Chiller',    price: 299, category: 'Drinks', type: 'Chillers', boxEligible: false, sortOrder: 160, description: 'Crisp and icy beverage with sweet strawberry flavor.', sourceImages: ['strawberryChillerSc', 'strawberryChiller2'] },
  { legacyId: 43, sku: 'DRK-WATER',                 slug: 'water',                 name: 'Water',                 price: 120, category: 'Drinks', type: 'Extras',   boxEligible: false, sortOrder: 170, description: 'Chilled bottled water.', sourceImages: ['waterImg'] },
]

export default CATALOGUE
