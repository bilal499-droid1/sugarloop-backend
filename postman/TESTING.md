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
http://localhost:4000/api/v1/staff/auth/me
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
POST  http://localhost:4000/api/v1/orders
GET   http://localhost:4000/api/v1/orders
POST  http://localhost:4000/api/v1/auth/otp/request
POST  http://localhost:4000/api/v1/auth/otp/verify
POST  http://localhost:4000/api/v1/enquiries
GET   http://localhost:4000/api/v1/staff/orders
GET   http://localhost:4000/api/v1/staff/stock
GET   http://localhost:4000/api/v1/staff/products
GET   http://localhost:4000/api/v1/staff/reports/daily
```

That is the edge of Sprint 1, not a bug. **No order can be placed yet.**

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
