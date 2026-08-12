# Sugarloop Backend

Ordering API for Sugarloop — a Cash-on-Delivery donut shop with four branches in
Islamabad. Node + Express + Mongoose + Zod on MongoDB, MVC layout, REST at `/api/v1`.

**Status: Sprint 1, roughly 70% complete.** A customer can browse the menu, be quoted a
price the server computed, and **place a Cash-on-Delivery order**. What is missing before
this can face the public is phone verification (OTP), notifications, and the staff order
board. See [Roadmap](#roadmap).

---

## Two rules that govern everything

**1. The browser never sends a price.** It sends `{ productId, qty }`. The server looks up
every price, recomputes every total, and stores its own numbers. The current frontend
trusts `localStorage`, where anyone can edit a price to `1` in devtools.

**2. The currency is PKR, stored as whole hundredths of a rupee.** `29900` is Rs 299,
the way card processors store USD as cents. No floats, ever — `0.1 + 0.2`
is not `0.3`, and a rounding error in a price is a rounding error in someone's bill.

---

## Getting started

Requires **Node 20+** and a running **MongoDB** (local or an Atlas connection string).

```bash
npm install
cp .env.example .env          # then edit — see below
npm run seed                  # 4 branches, 43 products, 172 stock rows, 5 staff
npm run dev                   # http://localhost:4000
```

Check it came up:

```bash
curl http://localhost:4000/api/v1/health/ready
# {"data":{"status":"ready","database":"connected"}}
```

### Environment

Copy `.env.example` and fill it in. The API validates every variable at boot and refuses
to start if one is missing — a config mistake should fail on deploy, not at 2am.

| Variable | Notes |
|---|---|
| `MONGODB_URI` | local for dev, an Atlas SRV string otherwise |
| `CORS_ORIGINS` | comma-separated allow-list |
| `JWT_CUSTOMER_SECRET` | `openssl rand -base64 48` |
| `JWT_STAFF_SECRET` | **different** secret — a leaked customer token must never work on a staff endpoint |
| `SEED_ADMIN_PASSWORD` | seed script only; the API never reads it |

### Staff sign-in

`npm run seed` prints a generated password **once**. To set your own:

```bash
SEED_ADMIN_PASSWORD='YourPassword123!' npm run seed -- --fresh
```

`--fresh` drops and recreates, and is refused outside development. It is required to
change an existing password — a normal re-seed deliberately never touches one.

All five seeded accounts share that password:

| Email | Role | Branch |
|---|---|---|
| `admin@sugarloop.pk` | admin | all |
| `dha1.manager@sugarloop.pk` | branch_manager | DHA1 |
| `dha2.manager@sugarloop.pk` | branch_manager | DHA2 |
| `bahria4.manager@sugarloop.pk` | branch_manager | BAH4 |
| `nust.manager@sugarloop.pk` | branch_manager | NUST |

---

## Scripts

```bash
npm run dev          # watch mode
npm start            # production
npm run seed         # idempotent — safe to re-run
npm run seed -- --fresh
npm run lint
npm test             # node:test, no framework
npm run test:watch
npm run check        # lint + test — what CI should run
npm run test:api     # newman against the Postman collection (needs the server up)
```

---

## API

Every route is under **`/api/v1`**. Success is `{ data }`, failure is
`{ error: { code, message, details, requestId } }`.

### Public

```
GET  /health/live                    process up (never touches the database)
GET  /health/ready                   database reachable; 503 if not

GET  /products                       all 43
GET  /products?category=Donuts       Donuts 19 · Croissants 4 · Sandwiches 3 · Drinks 17
GET  /products?type=Crafted Donuts
GET  /products?boxEligible=true      23 — what Build Your Box may contain
GET  /products?branchId=<id>         adds `inStock` per item for that branch
GET  /products/:slug

GET  /branches                       + isOpenNow, isAcceptingOrders, computed server-side
GET  /branches/:code                 DHA1 · DHA2 · BAH4 · NUST

POST /checkout/quote                 prices a cart — the server, never the browser
```

`POST /checkout/quote` takes ids and quantities only:

```json
{
  "fulfilment": "delivery",
  "location": { "lat": 33.5312, "lng": 73.1574 },
  "items": [
    { "kind": "product", "productId": "...", "qty": 2 },
    { "kind": "box", "boxSize": 4, "productIds": ["...", "...", "...", "..."] }
  ]
}
```

For `pickup`, send `branchCode` (or `branchId`) instead of `location` — the customer
chooses the branch. It returns the branch, per-line totals with a tax breakdown, and the
grand total. It rejects with `MINIMUM_ORDER_NOT_MET`, `ITEMS_UNAVAILABLE`,
`OUTSIDE_DELIVERY_AREA`, `BRANCH_NOT_ACCEPTING_ORDERS` or `INVALID_BOX`, each carrying the
detail a UI needs to explain itself.

```
POST /orders                         places an order
GET  /orders/:orderNumber?phone=     one order — see the note below
```

`POST /orders` is the quote plus `contact`, `address` and **`expectedTotal`** — the grand
total the customer was shown. The server re-runs the pricing engine from scratch and, if
anything moved since the quote, rejects with `PRICE_CHANGED` rather than silently charging
a different number. Orders are numbered `SL-YYMMDD-NNNN`, allocated atomically, and only
after pricing succeeds so a rejected cart never burns a number.

⚠️ `GET /orders/:orderNumber` requires the phone the order was placed with. Order numbers
are sequential and enumerable, so an unguarded lookup would hand over every customer's
address by counting. This is interim — Sprint 2's phone-OTP session replaces it.

### Staff — `Authorization: Bearer <accessToken>`

```
POST /staff/auth/login               { email, password }
POST /staff/auth/refresh             refresh token is an httpOnly cookie
POST /staff/auth/logout
POST /staff/auth/logout-all
GET  /staff/auth/me

GET    /staff/users                  admin only
POST   /staff/users
GET    /staff/users/:id
PATCH  /staff/users/:id
POST   /staff/users/:id/password
DELETE /staff/users/:id              soft delete — deactivates, never removes
```

Access tokens last 15 minutes; refresh tokens 7 days and rotate on every use.

---

## Testing

**Unit** — `node:test`, no framework, tests co-located as `*.test.js`:

```bash
npm run check
```

**API** — a Postman collection in [`postman/`](postman/):

- `sugarloop-simple.postman_collection.json` — 20 plain requests for clicking through
- `sugarloop-api.postman_collection.json` — 66 requests, 437 assertions, for regression
- `TESTING.md` — every endpoint as a copy-paste request with real ids

```bash
npm run test:api -- --env-var "adminPassword=YOUR_PASSWORD"
```

See [`postman/README.md`](postman/README.md) for setup.

---

## Project layout

Route → controller → service → model, plus a `views/` serialiser layer.

```
src/
  config/       env validation, db, logger, and every business rule in constants.js
  models/       Mongoose schemas — Product, Branch, BranchStock, Order, Counter, staff
  controllers/  thin — read request, call service, shape response. No Mongoose.
  services/     the actual business rules
  views/        the only thing that decides what leaves the API
  routes/       one router per resource
  middleware/   auth, rbac, Zod validation, rate limits, error handling
  validators/   a Zod schema per endpoint
  utils/        money (PKR), time (opening hours), ApiError
  itemData.js   the 43-product catalogue — seed input, not runtime data
  scripts/      seed.js
```

Two rules keep this honest:

- **Controllers never touch Mongoose.** Otherwise the pricing rules smear across five route
  handlers and stop being testable.
- **The `views/` layer is not optional.** A raw order document carries `meta.ip`,
  `statusHistory` with staff ids, and internal cost fields. `views/` is what stops that
  leaking — the most common way a JSON API accidentally exposes data.

---

## Domain notes

**Opening hours cross midnight.** 11:00 → 03:00 is not a range: `now >= open && now < close`
is false at 1am and true at noon, exactly backwards. `utils/time.js` straightens the wrap
onto one number line and is unit-tested at every awkward minute. Orders stop at **02:30** —
a 30-minute buffer so the last order lands near closing rather than 40 minutes past it.
Everything resolves in `Asia/Karachi` through the timezone database, never a fixed offset.

**Price is global, stock is per branch.** One price list; a manager can only toggle items
in and out of stock at their own branch.

**Branches do not share orders.** Each serves its own 2 km radius. An address outside every
radius is refused. If the assigned branch is sold out or paused, the order is refused
rather than rerouted.

**Tax is 0% and nothing is filed to FBR** — but every product and order carries the fiscal
shape, because FBR reports per line item and retrofitting that onto historical orders is
the expensive migration this design exists to avoid.

---

## Roadmap

| Step | State |
|---|---|
| 1 Skeleton | ✅ local — no staging deploy, no CI |
| 2 Models + seed | ✅ |
| 3 Catalogue endpoints | ✅ |
| 4 Hours engine | ✅ |
| 5 Pricing engine | ✅ |
| 6 Orders + numbering | ✅ |
| 7 Staff auth + RBAC | ✅ built ahead of order |
| **8 Order status + stock toggles** | ❌ **next** |
| 9 Geocoding + branch assignment | ❌ unblocked — real coordinates are in |
| 10 Staging deploy | ❌ |

Sprint 2 and beyond: customer phone OTP, WhatsApp Cloud API, SMS fallback, BullMQ status
timers, PDF invoices, corporate enquiries, daily reports, admin product CRUD, Cloudinary
uploads.

### Known gaps in the seeded data

- **Branch phone numbers** — all four share the single storefront line. Real per-branch
  numbers are still owed, and matter: every WhatsApp template ends with "call us on
  `<branch number>`".
- **NUST H-12 hours** — seeded 11:00–03:00 like the rest, but it trades inside a university
  building and almost certainly closes earlier. Until corrected it will accept 2am orders.
- **Product images** — seeded empty. Blocked on moving Cloudinary to a client-owned
  account; `itemData.js` keeps the frontend asset names so the mapping is not lost.
- **Delivery coverage** — at 2 km the four branches cover ~48 km² of Islamabad. DHA1,
  BAH4 and DHA2 form a continuous corridor; NUST is isolated.

Background and client decisions live in [`docs/`](docs/).
