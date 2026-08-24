# Postman testing guide — copy & paste

Every request below is a **full URL**. Copy the line, paste it into Postman's URL bar,
pick the method, paste the body if there is one. Nothing needs editing.

Server must be running (`npm run dev`) on port 4000.

**Password for all staff accounts:** `SugarloopDev123!`
*(Changes if you re-seed. See §9.)*

**IDs in this file are from your current database.** They change on every
`npm run seed -- --fresh`. Refresh them with request **2.1**.

| Branch | `_id` |
|---|---|
| DHA1 | `6a7c2fbe9758de53ab6f5b91` |
| DHA2 | `6a7c2fbe9758de53ab6f5b92` |
| BAH4 | `6a7c2fbe9758de53ab6f5b93` |
| NUST | `6a7c2fbe9758de53ab6f5b94` |

---

# 1 · Health

### 1.1 Is the server up
```
GET
http://localhost:4000/api/v1/health/live
```
No auth, no body. → `200`

### 1.2 Is the database connected
```
GET
http://localhost:4000/api/v1/health/ready
```
→ `200` if Mongo is reachable, `503` if not.

### 1.3 API root
```
GET
http://localhost:4000/api/v1/
```

---

# 2 · Branches — no auth needed

### 2.1 All branches  ← run this first
```
GET
http://localhost:4000/api/v1/branches
```
→ 4 branches. Copy the `id` values from here if yours differ from the table above.

### 2.2 One branch by code
```
GET
http://localhost:4000/api/v1/branches/DHA1
```
```
GET
http://localhost:4000/api/v1/branches/DHA2
```
```
GET
http://localhost:4000/api/v1/branches/BAH4
```
```
GET
http://localhost:4000/api/v1/branches/NUST
```

### 2.3 Lowercase code also works
```
GET
http://localhost:4000/api/v1/branches/dha1
```

### 2.4 Only branches offering pickup
```
GET
http://localhost:4000/api/v1/branches?fulfilment=pickup
```

### 2.5 Unknown branch → 404
```
GET
http://localhost:4000/api/v1/branches/ZZ9
```

---

# 3 · Products — no auth needed

### 3.1 Whole menu
```
GET
http://localhost:4000/api/v1/products
```
→ 43 items. Prices are PKR stored as whole hundredths of a rupee: `29900` = **Rs 299**.
Every response also carries `priceFormatted`.

### 3.2 By category
```
GET
http://localhost:4000/api/v1/products?category=Donuts
```
```
GET
http://localhost:4000/api/v1/products?category=Croissants
```
```
GET
http://localhost:4000/api/v1/products?category=Sandwiches
```
```
GET
http://localhost:4000/api/v1/products?category=Drinks
```
→ 19 · 4 · 3 · 17

### 3.3 By menu section
```
GET
http://localhost:4000/api/v1/products?type=Signature
```
```
GET
http://localhost:4000/api/v1/products?type=Classic
```
```
GET
http://localhost:4000/api/v1/products?type=Crafted Donuts
```
```
GET
http://localhost:4000/api/v1/products?type=Fresh Bakes
```
```
GET
http://localhost:4000/api/v1/products?type=Hot Coffee
```
```
GET
http://localhost:4000/api/v1/products?type=Iced Coffee
```
```
GET
http://localhost:4000/api/v1/products?type=Blended Iced
```
```
GET
http://localhost:4000/api/v1/products?type=Chillers
```
```
GET
http://localhost:4000/api/v1/products?type=Extras
```

### 3.4 Only items allowed in a Build-Your-Box
```
GET
http://localhost:4000/api/v1/products?boxEligible=true
```
→ 23 items (donuts + croissants only)

### 3.5 Limit the result count
```
GET
http://localhost:4000/api/v1/products?limit=5
```

### 3.6 Menu **with stock** for one branch
```
GET
http://localhost:4000/api/v1/products?branchId=6a7c2fbe9758de53ab6f5b91
```
```
GET
http://localhost:4000/api/v1/products?branchId=6a7c2fbe9758de53ab6f5b92
```
→ every item now has `inStock`. Without `branchId` that field is **absent entirely**.

### 3.7 Combine filters
```
GET
http://localhost:4000/api/v1/products?category=Donuts&branchId=6a7c2fbe9758de53ab6f5b91
```

### 3.8 One product by slug
```
GET
http://localhost:4000/api/v1/products/lotus
```
```
GET
http://localhost:4000/api/v1/products/chocoholic
```
```
GET
http://localhost:4000/api/v1/products/kitkat-crunch
```
```
GET
http://localhost:4000/api/v1/products/butter-croissant
```
```
GET
http://localhost:4000/api/v1/products/mocha-frappe
```
```
GET
http://localhost:4000/api/v1/products/water
```

### 3.9 One product with stock for a branch
```
GET
http://localhost:4000/api/v1/products/lotus?branchId=6a7c2fbe9758de53ab6f5b92
```

### All 43 slugs

**Donuts / Signature** — Rs 299
`chocoholic` `lotus` `nutella` `coffee-donut` `salted-caramel` `boston-creme` `mix-berry` `brownie-filled` `mango`

**Donuts / Classic** — Rs 185–230
`classic-oreo` `chocolate-sprinkle` `classic-chocolate` `white-chocolate` `chocolate-glazed` `vanilla-glazed`

**Donuts / Crafted Donuts** — Rs 429
`snickers` `tiramisu-creme` `kinder-cream` `kitkat-crunch`

**Croissants / Fresh Bakes**
`chocolate-croissant` `butter-cream-croissant` `butter-croissant` `baked-cinnamon`

**Sandwiches**
`signature-chicken` `smoked-tikka-melt` `sizzling-fajita`

**Drinks / Hot Coffee**
`cappuccino` `latte` `spanish-latte` `caramel-latte`

**Drinks / Iced Coffee**
`iced-cappuccino` `iced-latte` `iced-spanish-latte` `iced-caramel-latte`

**Drinks / Blended Iced** — Rs 799
`caramel-frappe` `cookies-and-cream-frappe` `hazelnut-frappe` `double-chocolate-frappe` `mocha-frappe`

**Drinks / Chillers** — Rs 299
`passion-fruit-chiller` `wild-berry-chiller` `strawberry-chiller`

**Drinks / Extras**
`water`

---

# 3b · Checkout — pricing a cart

**No auth needed.** The server prices everything; the cart only sends ids and quantities.

Product ids below are from your current database — get fresh ones from `GET /products`.
```
kitkat-crunch   6a7c2fbe9758de53ab6f5ba7   Rs 429
lotus           6a7c2fbe9758de53ab6f5b96   Rs 299
classic-oreo    6a7c2fbe9758de53ab6f5b9e   Rs 185
```

### 3b.1 Delivery quote
```
POST
http://localhost:4000/api/v1/checkout/quote
```
**Headers**
```
Content-Type: application/json
```
**Body**
```json
{
  "fulfilment": "delivery",
  "location": { "lat": 33.5312, "lng": 73.1574 },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ]
}
```
→ assigned to **DHA2** (0.01 km away), subtotal Rs 858 + Rs 100 delivery = **Rs 958**.

### 3b.2 Pickup — no delivery fee
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA1",
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ]
}
```
→ **Rs 858**, no fee. For pickup the customer names the branch.

### 3b.3 The important one — post a fake price
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2, "price": 1, "lineTotal": 2 }
  ]
}
```
→ still **Rs 858**. The `price` and `lineTotal` you sent are stripped by the validator and
never read. This is the single rule the pricing engine exists to enforce.

### 3b.4 Build Your Box — 4 Crafted donuts
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "items": [
    {
      "kind": "box",
      "boxSize": 4,
      "productIds": [
        "6a7c2fbe9758de53ab6f5ba7",
        "6a7c2fbe9758de53ab6f5ba7",
        "6a7c2fbe9758de53ab6f5ba7",
        "6a7c2fbe9758de53ab6f5ba7"
      ]
    }
  ]
}
```
→ **Rs 1,716** (stored as 171600). Duplicates allowed; price is the plain sum of contents.

### 3b.5 Mixed box — different categories, with duplicates
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "items": [
    {
      "kind": "box",
      "boxSize": 4,
      "productIds": [
        "6a7c2fbe9758de53ab6f5ba7",
        "6a7c2fbe9758de53ab6f5b96",
        "6a7c2fbe9758de53ab6f5b9e",
        "6a7c2fbe9758de53ab6f5b96"
      ]
    }
  ]
}
```
→ **Rs 1,212**. Mixing categories is allowed.

### 3b.6 Products and a box in one cart
```json
{
  "fulfilment": "delivery",
  "location": { "lat": 33.5312, "lng": 73.1574 },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5b96", "qty": 3 },
    { "kind": "box", "boxSize": 2, "productIds": ["6a7c2fbe9758de53ab6f5ba7", "6a7c2fbe9758de53ab6f5b9e"] }
  ]
}
```

### 3b.7 Below the Rs 500 minimum → 409
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5b9e", "qty": 2 }
  ]
}
```
→ `MINIMUM_ORDER_NOT_MET` with `"shortfall": 13000` — Rs 130 more needed. The minimum is
judged on the **subtotal**, so the Rs 100 delivery fee never counts towards it.

### 3b.8 Outside every delivery radius → 409
```json
{
  "fulfilment": "delivery",
  "location": { "lat": 33.7104, "lng": 73.0551 },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ]
}
```
→ `OUTSIDE_DELIVERY_AREA`, and it tells you the nearest branch is 8.93 km away against a
2 km radius. Blue Area is outside all four circles.

### 3b.9 Box with the wrong number of items → 422
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "items": [
    { "kind": "box", "boxSize": 4, "productIds": ["6a7c2fbe9758de53ab6f5ba7", "6a7c2fbe9758de53ab6f5b96"] }
  ]
}
```
→ a box of 4 must hold exactly 4.

### 3b.10 Delivery with no coordinates → 422
```json
{
  "fulfilment": "delivery",
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ]
}
```

### 3b.11 Empty cart → 422
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "items": []
}
```

### Coordinates worth trying

| Where | lat, lng | Result |
|---|---|---|
| Nadir Arcade, DHA 2 | `33.5312, 73.1574` | DHA2, 0.01 km |
| Marina Commercial, Bahria 4 | `33.5466, 73.1233` | BAH4, 0.00 km |
| NUST H-12 campus | `33.6455, 72.9980` | NUST, 0.08 km |
| Between DHA1 and DHA2 | `33.5414, 73.1250` | BAH4, 0.60 km — it bridges the gap |
| Blue Area | `33.7104, 73.0551` | refused, 8.93 km |
| Bahria Phase 7 | `33.5200, 73.0900` | refused, 3.52 km |

### Checking sold-out behaviour

Mark something out of stock at one branch, then quote against both:

```bash
# in mongosh
db.branchstocks.updateOne(
  { branchId: ObjectId("6a7c2fbe9758de53ab6f5b92"), productId: ObjectId("6a7c2fbe9758de53ab6f5ba7") },
  { $set: { inStock: false } }
)
```

Quoting at **DHA2** now returns `ITEMS_UNAVAILABLE` — *"KitKat Crunch sold out at Sugar
Loop DHA 2"*, by name. The same cart at **DHA1** still prices normally. Set it back to
`true` when you're done.

---

# 3c · Placing an order

Two steps, always. Quote first, then send the total you were shown back with the order —
the server re-prices from scratch and **rejects** if anything moved, rather than silently
charging a different number.

### 3c.1 Get a quote and note `grandTotal.amount`
```
POST
http://localhost:4000/api/v1/checkout/quote
```
```json
{
  "fulfilment": "delivery",
  "location": { "lat": 33.5312, "lng": 73.1574 },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ]
}
```
→ `grandTotal.amount` is **95800**. That is your `expectedTotal` below.

### 3c.2 Place it
```
POST
http://localhost:4000/api/v1/orders
```
**Headers**
```
Content-Type: application/json
```
**Body**
```json
{
  "fulfilment": "delivery",
  "location": { "lat": 33.5312, "lng": 73.1574 },
  "address": {
    "line1": "House 12, Street 4",
    "area": "Sector E",
    "notes": "Blue gate"
  },
  "contact": {
    "name": "Ayesha Khan",
    "phone": "03001234567"
  },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ],
  "expectedTotal": 95800
}
```
→ `201` with an order number like **`SL-260812-0001`**. Copy it.

The phone comes back as `+923001234567` — `03001234567`, `+92 300 1234567` and
`0300-1234567` all normalise to the same stored value.

### 3c.3 Pickup order — no address, no delivery fee
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "contact": { "name": "Ayesha Khan", "phone": "03001234567" },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ],
  "expectedTotal": 85800
}
```

### 3c.4 Order a box
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "contact": { "name": "Ayesha Khan", "phone": "03001234567" },
  "items": [
    {
      "kind": "box",
      "boxSize": 4,
      "productIds": [
        "6a7c2fbe9758de53ab6f5ba7",
        "6a7c2fbe9758de53ab6f5b96",
        "6a7c2fbe9758de53ab6f5b9e",
        "6a7c2fbe9758de53ab6f5b96"
      ]
    }
  ],
  "expectedTotal": 121200
}
```
The order stores what was in the box, not just the total — otherwise a reorder is
impossible.

### 3c.5 Look it up — needs the phone it was placed with
```
GET
http://localhost:4000/api/v1/orders/SL-260812-0001?phone=03001234567
```

### 3c.6 Wrong phone → 404
```
GET
http://localhost:4000/api/v1/orders/SL-260812-0001?phone=03009999999
```
Order numbers are sequential, so anyone could count through them. **404, not 403** —
confirming an order exists but belongs to someone else leaks the same thing.
This is interim; the OTP session in Sprint 2 replaces it.

### 3c.7 A stale total → 409
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "contact": { "name": "Stale Quote", "phone": "03001234567" },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ],
  "expectedTotal": 50000
}
```
→ `PRICE_CHANGED` with `quotedTotal`, `currentTotal` and `difference`, so the UI can say
exactly what moved. Nothing is written and **no order number is consumed** — gaps in a
sequential order book look like lost orders.

### 3c.8 Delivery with no address → 422
Same as 3c.2 but drop the `address` block. Coordinates alone are not somewhere a rider
can go.

### 3c.9 A phone that isn't Pakistani → 422
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "contact": { "name": "Bad Phone", "phone": "12345" },
  "items": [
    { "kind": "product", "productId": "6a7c2fbe9758de53ab6f5ba7", "qty": 2 }
  ],
  "expectedTotal": 85800
}
```

### Watching the numbering

Place several orders in a row and the sequence increments — `SL-260812-0001`, `0002`,
`0003`. The date is the Karachi calendar date and the counter restarts each day. It's
allocated atomically, so two customers checking out in the same second can never collide.

---

# 4 · Staff login

### 4.1 Log in as admin  ← run before anything in §5, §6
```
POST
http://localhost:4000/api/v1/staff/auth/login
```
**Headers**
```
Content-Type: application/json
```
**Body** → raw → JSON
```json
{
  "email": "admin@sugarloop.pk",
  "password": "SugarloopDev123!"
}
```
**Copy `data.accessToken` from the response.** You need it for every staff request below.

### 4.2 Log in as a branch manager
```
POST
http://localhost:4000/api/v1/staff/auth/login
```
```json
{
  "email": "dha1.manager@sugarloop.pk",
  "password": "SugarloopDev123!"
}
```
Other managers — same body, swap the email:
```
dha2.manager@sugarloop.pk
bahria4.manager@sugarloop.pk
nust.manager@sugarloop.pk
```

### 4.3 Who am I
```
GET


```
**Headers**
```
Authorization: Bearer PASTE_YOUR_ACCESS_TOKEN_HERE
```

### 4.4 Get a fresh access token
```
POST
http://localhost:4000/api/v1/staff/auth/refresh
```
**Headers**
```
Content-Type: application/json
```
**Body**
```json
{}
```
Works off the httpOnly cookie Postman is already holding. Access tokens die after
**15 minutes** — run this when staff requests start returning 401.

### 4.5 Log out
```
POST
http://localhost:4000/api/v1/staff/auth/logout
```
**Body**
```json
{}
```
→ `204 No Content`

### 4.6 Log out everywhere
```
POST
http://localhost:4000/api/v1/staff/auth/logout-all
```
**Headers**
```
Authorization: Bearer PASTE_YOUR_ACCESS_TOKEN_HERE
```

---

# 5 · Staff accounts — admin token required

All of these need:
```
Authorization: Bearer PASTE_YOUR_ADMIN_TOKEN_HERE
```

### 5.1 List all staff
```
GET
http://localhost:4000/api/v1/staff/users
```

### 5.2 Filter the list
```
GET
http://localhost:4000/api/v1/staff/users?role=branch_manager
```
```
GET
http://localhost:4000/api/v1/staff/users?isActive=true
```
```
GET
http://localhost:4000/api/v1/staff/users?branchId=6a7c2fbe9758de53ab6f5b91
```
```
GET
http://localhost:4000/api/v1/staff/users?limit=2
```

### 5.3 Create a branch manager
```
POST
http://localhost:4000/api/v1/staff/users
```
**Headers**
```
Content-Type: application/json
Authorization: Bearer PASTE_YOUR_ADMIN_TOKEN_HERE
```
**Body**
```json
{
  "name": "Test Manager",
  "email": "test.manager@sugarloop.pk",
  "password": "TestPassword123!",
  "role": "branch_manager",
  "branchId": "6a7c2fbe9758de53ab6f5b91"
}
```
→ `201`. **Copy `data.staffUser.id`** for the next four requests.
Change the email on each re-run, or you get `409`.

### 5.4 Create an admin
```
POST
http://localhost:4000/api/v1/staff/users
```
```json
{
  "name": "Second Admin",
  "email": "second.admin@sugarloop.pk",
  "password": "AdminPassword123!",
  "role": "admin"
}
```
An admin has **no** `branchId`.

### 5.5 Get one staff member
```
GET
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE
```

Existing seeded ids, if you'd rather not create one:
```
admin@sugarloop.pk            6a7c2fbe6f63dd932a6173bc
dha1.manager@sugarloop.pk     6a7c2fbf6f63dd932a6173bf
dha2.manager@sugarloop.pk     6a7c2fbf6f63dd932a6173c2
bahria4.manager@sugarloop.pk  6a7c2fbf6f63dd932a6173c5
nust.manager@sugarloop.pk     6a7c2fc06f63dd932a6173c8
```

### 5.6 Rename them
```
PATCH
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE
```
**Body**
```json
{
  "name": "Renamed Manager"
}
```

### 5.7 Move them to another branch
```
PATCH
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE
```
```json
{
  "branchId": "6a7c2fbe9758de53ab6f5b92"
}
```

### 5.8 Deactivate / reactivate
```
PATCH
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE
```
```json
{
  "isActive": false
}
```

### 5.9 Reset their password
```
POST
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE/password
```
```json
{
  "password": "BrandNewPassword123!"
}
```

### 5.10 Soft delete
```
DELETE
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE
```
**Headers**
```
Authorization: Bearer PASTE_YOUR_ADMIN_TOKEN_HERE
```
Sets `isActive: false`. The row stays so the audit trail still resolves.

---

# 5b · The order board — staff token required

Both roles work this board. What differs is **scope, and scope comes from the token**: an
admin sees all four branches, a branch manager sees their own and nothing else. Log in at
**4.1** (admin) or **4.2** (manager).

You need an order to work on — place one at **3c.2** first, and note which branch it landed
at. A manager for a different branch will see an empty board, which is the rule working.

### 5b.1 Today's board
```
GET
http://localhost:4000/api/v1/staff/orders
```
**Headers**
```
Authorization: Bearer PASTE_YOUR_TOKEN_HERE
```
**Copy `data[0].id`** — the status requests below need the order's `id`, not its number.

The staff view carries what the customer view withholds: `id`, `branchId`, `distanceKm`,
the rider's `address.location`, the customer's email, and the full `statusHistory` naming
whoever caused each move. `meta.ip` and `meta.userAgent` stay internal even here.

### 5b.2 Filter it
```
GET
http://localhost:4000/api/v1/staff/orders?status=placed
GET
http://localhost:4000/api/v1/staff/orders?fulfilment=delivery
GET
http://localhost:4000/api/v1/staff/orders?phone=03001234567
GET
http://localhost:4000/api/v1/staff/orders?limit=10
```

`date` is a calendar date in **Asia/Karachi** — the day the kitchen means by "today", not
the one a server on UTC would compute five hours early:
```
GET
http://localhost:4000/api/v1/staff/orders?date=2026-08-13
```

An admin — and only an admin — may narrow to one branch:
```
GET
http://localhost:4000/api/v1/staff/orders?branchId=6a7c2fbe9758de53ab6f5b92
```

Lists are cursor-paginated. `meta.nextCursor` feeds the next page:
```
GET
http://localhost:4000/api/v1/staff/orders?limit=2&cursor=PASTE_NEXT_CURSOR_HERE
```

### 5b.3 One order, and what it may do next
```
GET
http://localhost:4000/api/v1/staff/orders/PASTE_ORDER_ID_HERE
```
**Headers**
```
Authorization: Bearer PASTE_YOUR_TOKEN_HERE
```
Returns `data.order` plus `data.transitions`:
```json
{
  "allowed": ["confirmed", "failed"],
  "isTerminal": false
}
```
That is the list of legal next moves. Draw one button per entry rather than guessing at
the state machine and being refused by the server.

### 5b.4 Move it forward

```
placed → confirmed → preparing → out_for_delivery ┐
                               → ready_for_pickup ┘→ completed
any non-terminal ──────────────────────────────────→ failed
```

One step at a time, forwards only — `statusHistory` is a record of what happened, not a
form to correct.

```
PATCH
http://localhost:4000/api/v1/staff/orders/PASTE_ORDER_ID_HERE/status
```
**Headers**
```
Content-Type: application/json
Authorization: Bearer PASTE_YOUR_TOKEN_HERE
```
**Body**
```json
{
  "status": "confirmed",
  "note": "Rang the customer to confirm the address"
}
```
`note` is optional on any move and goes onto the history event. Then repeat with
`"preparing"`, then the handover step, then `"completed"`.

**The handover step follows the fulfilment.** A delivery order goes `out_for_delivery`; a
pickup order goes `ready_for_pickup`. Sending the wrong one is a `409` — that is what stops
a rider being dispatched to an order that carries no address at all.

### 5b.5 Completing a COD order collects the cash
```json
{ "status": "completed" }
```
The response comes back with `payment.status: "collected"`. With cash on delivery,
completion *is* collection — an order book where every completed order still reads
`pending` cannot produce a day's takings.

`transitions.allowed` is now `[]` and `isTerminal` is `true`.

### 5b.6 Or fail it — staff only, terminal, reason mandatory
```
PATCH
http://localhost:4000/api/v1/staff/orders/PASTE_ORDER_ID_HERE/status
```
```json
{
  "status": "failed",
  "reason": "no_answer",
  "note": "Called four times, phone off"
}
```

| Reason code | Meaning |
|---|---|
| `no_answer` | Customer didn't answer the door / phone |
| `unreachable` | Phone off, address not findable |
| `bad_address` | Address fake, incomplete, or outside the 2 km zone |
| `refused_substitute` | Item sold out, customer declined the alternative |
| `customer_request` | Customer asked to drop it — staff-recorded, not self-service |
| `branch_unable` | Kitchen couldn't fulfil — power cut, equipment, staffing |
| `other` | **Note required** |

Fixed codes rather than free text so the counts are reportable: a spike in `no_answer`
means OTP isn't filtering prank orders well enough. The reason lands on `failureReason`
(terminal and reportable) and on the history event, and the customer is told it — they are
owed the reason. `payment.status` stays `pending`; failed orders are excluded from revenue.

### 5b.7 The refusals

| Body | Result |
|---|---|
| `{"status":"completed"}` on a `placed` order | `409` — skipping ahead, with `details.allowed` |
| `{"status":"confirmed"}` on a `confirmed` order | `409` — already there; a double-click, not an attack |
| `{"status":"out_for_delivery"}` on a pickup order | `409` — with `details.fulfilment` naming why |
| `{"status":"failed"}` | `422` — a reason is mandatory |
| `{"status":"failed","reason":"other"}` | `422` — `other` needs a note |
| `{"status":"confirmed","reason":"no_answer"}` | `422` — a reason only belongs on a failure |
| anything on a `completed` or `failed` order | `409` — terminal |

**Two people, one button.** Open the same order in two tabs and PATCH the same transition
from both. One gets `200`, the other `409` — the write is conditional on the order still
being in the state that was validated, so a polling dashboard can never append the same
transition twice.

---

# 5c · Stock — the one write a branch manager gets

Price is global and only a developer can change it. Availability is local, and the manager
standing in front of the empty tray flips it.

### 5c.1 The stock sheet
```
GET
http://localhost:4000/api/v1/staff/stock
```
**Headers**
```
Authorization: Bearer PASTE_A_MANAGER_TOKEN_HERE
```
All 43 sellable products with their availability at that manager's branch — including the
ones nobody has ever toggled, which have no stock row at all and default to in stock.
`stockUpdatedAt: null` is how you tell those apart from "somebody set this in stock this
morning".

An **admin has no branch**, so they must name one — there is no "all branches" answer to
"is this in stock", and silently picking one would let a toggle land somewhere nobody
looked:
```
GET
http://localhost:4000/api/v1/staff/stock?branchId=6a7c2fbe9758de53ab6f5b92
```
Without it: `422`, naming `branchId`.

### 5c.2 What is sold out right now — the dashboard default
```
GET
http://localhost:4000/api/v1/staff/stock?inStock=false
GET
http://localhost:4000/api/v1/staff/stock?category=Donuts
```

### 5c.3 Mark something sold out
```
PATCH
http://localhost:4000/api/v1/staff/stock/6a7c2fbe9758de53ab6f5b96
```
**Headers**
```
Content-Type: application/json
Authorization: Bearer PASTE_A_MANAGER_TOKEN_HERE
```
**Body**
```json
{ "inStock": false }
```
Keyed by **product** id, not by a stock-row id: the row may not exist yet, and the manager
knows what the product is, not what its stock record is called. The first toggle creates
the row.

An admin adds the branch to the body:
```json
{ "inStock": false, "branchId": "6a7c2fbe9758de53ab6f5b92" }
```

**It takes a value, not a flip.** `{"inStock": false}` twice is idempotent — a retry, a
double-tap in a hot kitchen, or two managers acting at once all converge. A `/toggle`
endpoint that flips whatever it finds does not: two clicks that race leave the tray marked
available.

### 5c.4 Watch it propagate

The public menu at that branch:
```
GET
http://localhost:4000/api/v1/products?branchId=6a7c2fbe9758de53ab6f5b92
```
→ that product now reads `"inStock": false`.

**And nowhere else** — the same id against another branch is still `true`. That is the
entire reason `BranchStock` is its own collection: an empty tray at DHA2 must not hide the
item across the city.

Checkout refuses it:
```
POST
http://localhost:4000/api/v1/checkout/quote
```
```json
{
  "fulfilment": "pickup",
  "branchCode": "DHA2",
  "items": [{ "kind": "product", "productId": "6a7c2fbe9758de53ab6f5b96", "qty": 2 }]
}
```
→ `409 ITEMS_UNAVAILABLE`, with `details.outOfStock` naming the item so a UI can explain
itself. Put it back with `{"inStock": true}`.

### 5c.5 Scope, and the refusals

| Request | Result |
|---|---|
| Manager sending another branch's `branchId` | `403` — nothing is written |
| Manager reading another branch's stock or orders | `403` on the list, `404` on one order |
| `PATCH /staff/stock/000000000000000000000000` | `404` — unknown product |
| `PATCH /staff/stock/not-an-id` | `422` |
| `PATCH` with `{}` | `422` — `inStock` is required |
| A discontinued (`isActive: false`) product | `404` — it cannot be brought back by a toggle |

Another branch's **order** is `404` rather than `403` on purpose: confirming that an order
exists but belongs to someone else is the same leak in a politer tone.

### 5c.6 The audit trail

Every status move and every stock toggle writes an `auditLog` row — actor, action, and the
before/after. Setting a value it already has is a deliberate no-op and writes nothing; a
double-tap should not fill the trail with rows recording nothing.

```
# in mongosh
use sugarloop
db.auditlogs.find({ action: { $in: ['order.status.change', 'stock.toggle'] } })
  .sort({ createdAt: -1 }).limit(10).pretty()
```

---

# 6 · Deliberate failures — these *should* break

### 6.1 Unknown product → 404
```
GET
http://localhost:4000/api/v1/products/does-not-exist
```

### 6.2 Badly formed slug → 422
```
GET
http://localhost:4000/api/v1/products/Not_A_Slug
```

### 6.3 Category outside the list → 422
```
GET
http://localhost:4000/api/v1/products?category=Pizza
```

### 6.4 Badly formed branch id → 422
```
GET
http://localhost:4000/api/v1/products?branchId=nope
```

### 6.5 Well-formed but unknown branch id → 404
```
GET
http://localhost:4000/api/v1/products?branchId=000000000000000000000000
```
Refuses rather than quietly returning the whole menu.

### 6.6 Limit above the maximum → 422
```
GET
http://localhost:4000/api/v1/products?limit=999
```

### 6.7 Staff route with no token → 401
```
GET
http://localhost:4000/api/v1/staff/users
```
Send no `Authorization` header.

### 6.8 Staff route with a junk token → 401
```
GET
http://localhost:4000/api/v1/staff/users
```
**Headers**
```
Authorization: Bearer not.a.real.token
```

### 6.9 Branch manager on an admin route → 403
```
GET
http://localhost:4000/api/v1/staff/users
```
**Headers**
```
Authorization: Bearer PASTE_A_MANAGER_TOKEN_HERE
```
`403`, not `401` — they are authenticated, just not entitled. Use the token from **4.2**.

### 6.10 Wrong password → 401
```
POST
http://localhost:4000/api/v1/staff/auth/login
```
```json
{
  "email": "admin@sugarloop.pk",
  "password": "wrong-password"
}
```

### 6.11 Unknown account → 401, identical message
```
POST
http://localhost:4000/api/v1/staff/auth/login
```
```json
{
  "email": "nobody@sugarloop.pk",
  "password": "wrong-password"
}
```
Same response as 6.10 on purpose — otherwise you could discover which emails exist.

### 6.12 Malformed email → 422
```
POST
http://localhost:4000/api/v1/staff/auth/login
```
```json
{
  "email": "not-an-email",
  "password": "whatever"
}
```

### 6.13 Empty update → 422
```
PATCH
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE
```
```json
{}
```
An empty PATCH is a client bug, not a successful no-op.

### 6.14 Password too short → 422
```
POST
http://localhost:4000/api/v1/staff/users/PASTE_STAFF_ID_HERE/password
```
```json
{
  "password": "short"
}
```
Minimum 12 characters.

### 6.15 Duplicate email → 409
```
POST
http://localhost:4000/api/v1/staff/users
```
```json
{
  "name": "Duplicate",
  "email": "dha2.manager@sugarloop.pk",
  "password": "TestPassword123!",
  "role": "branch_manager",
  "branchId": "6a7c2fbe9758de53ab6f5b91"
}
```

### 6.16 Unknown route → 404
```
GET
http://localhost:4000/api/v1/nope/not/a/route
```
Still returns the JSON error envelope, never an HTML error page.

---

# 7 · Not built yet — every one of these returns 404

```
POST  http://localhost:4000/api/v1/auth/otp/request
POST  http://localhost:4000/api/v1/auth/otp/verify
POST  http://localhost:4000/api/v1/enquiries
POST  http://localhost:4000/api/v1/branches/resolve
GET   http://localhost:4000/api/v1/staff/products
GET   http://localhost:4000/api/v1/staff/reports/daily
```

That is the edge of what is built. Orders can be placed (§3c), worked through to
completion (§5b) and their stock toggled (§5c).

---

# 8 · Response shapes

**Success**
```json
{ "data": { } }
```

**Success, list**
```json
{ "data": [ ], "meta": { "count": 43, "branchId": null } }
```

**Failure**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Product not found",
    "requestId": "8bd7f889-835f-45ad-a49b-ed1c7289ad91"
  }
}
```

**Validation failure** adds `details`:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [ { "field": "email", "message": "Must be a valid email address" } ]
  }
}
```

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` 422 | the request itself was malformed |
| `UNAUTHORIZED` 401 | no token, bad token, or wrong credentials |
| `FORBIDDEN` 403 | authenticated, but not allowed |
| `NOT_FOUND` 404 | no such thing |
| `CONFLICT` 409 | already exists |
| `TOO_MANY_REQUESTS` 429 | rate limited |

Every response carries an **`x-request-id`** header, repeated in the error body. Quote it
when reporting a problem — it appears in the server logs.

---

# 9 · When things go wrong

| Symptom | Cause |
|---|---|
| `Route GET /branches/ does not exist` | Missing the `/api/v1` prefix |
| `Must be a valid email address` on a correct email | A stray `'` or space inside the JSON string |
| 401 on login with the right password | Different password seeded — see below |
| 401 on a staff route that worked a minute ago | Access token expired (15 min). Run **4.4** |
| 403 where you expected data | Logged in as a manager, not admin |
| 409 creating staff | That email already exists — change it |
| 429 | Rate limited. 300/min overall; login 20 per 15 min counting failures only |
| Everything 404s | Server not running, or on a different port |
| Ids in this file don't exist | You re-seeded. Refresh them with **2.1** |

**Reset the password to a known value:**
```bash
SEED_ADMIN_PASSWORD='SugarloopDev123!' npm run seed -- --fresh
```
This regenerates all ids in this file. Re-run **2.1** afterwards.
