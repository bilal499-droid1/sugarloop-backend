# Sugarloop Backend

Ordering API for Sugarloop — a Cash-on-Delivery donut shop with four branches in
Islamabad. Node + Express + Mongoose + Zod on MongoDB, MVC layout, REST at `/api/v1`.

**Status: Sprint 1 feature-complete; not yet deployable.** A customer can browse the menu,
be quoted a price the server computed, **verify their phone by OTP**, and **place a
Cash-on-Delivery order**; a branch can then **work that order through to completion** and
toggle its own stock.

Two things stand between this and real customers, and neither is code we can finish alone:

- **Nothing actually delivers an OTP.** WhatsApp needs the client's Meta Business account
  and per-template approval (1–3 days each, ×7 templates); SMS needs a Twilio account.
  Until one exists, `OTP_TRANSPORT=log` prints codes to the console and the server refuses
  to boot in production. **This is calendar time, not dev time — start the application now.**
- **There is no deploy.** No staging, no CI, and the accounts (Atlas, Render) still need to
  be created in the client's name.

See [Roadmap](#roadmap).

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

GET    /staff/orders                 ?status= &fulfilment= &branchId= &date= &phone=
GET    /staff/orders/:id             + the transitions this order may make next
PATCH  /staff/orders/:id/status      { status, reason?, note? }

GET    /staff/stock                  ?branchId= &category= &inStock=
PATCH  /staff/stock/:productId       { inStock, branchId? }
```

Access tokens last 15 minutes; refresh tokens 7 days and rotate on every use.

**Branch scope comes from the token, never the query.** A `branch_manager` reads and moves
orders at their own branch only; naming another branch's `branchId` is `403`, and another
branch's order is `404` rather than `403` — confirming an order exists but is not yours is
the same leak in a politer tone. An admin sees every branch and may narrow to one. Stock is
per branch, so an admin **must** name one: there is no "all branches" answer to "is this in
stock".

`date` is a calendar date in `Asia/Karachi` — the day the kitchen means by "today", not the
one a server on UTC would compute five hours early.

### Order status

```
placed → confirmed → preparing → out_for_delivery ┐
                               → ready_for_pickup ┘→ completed
any non-terminal ──────────────────────────────────→ failed
```

One step at a time, forwards only — `statusHistory` is a record of what happened, not a
form to correct. The handover step follows the order's fulfilment: a pickup order can never
be sent `out_for_delivery`, which is what stops a rider being dispatched to an order that
carries no address. `GET /staff/orders/:id` returns the legal next moves alongside the
order, so the board draws one button per transition rather than guessing at the machine.

`failed` is staff-only and terminal, and requires a `reason` from the fixed list —
`no_answer`, `unreachable`, `bad_address`, `refused_substitute`, `customer_request`,
`branch_unable`, `other` — with `other` additionally requiring a `note`. Fixed codes, so a
monthly count by reason is reportable: a spike in `no_answer` means OTP is not filtering
prank orders well enough.

Completing a COD order sets `payment.status` to `collected` — with cash on delivery,
completion *is* collection, and an order book where every completed order still reads
`pending` cannot produce a day's takings.

Transitions are conditional writes. Two managers on a 15s-polling board who click the same
button get one success and one `409` telling the loser to refresh, rather than two
transitions appended to one order. Every move and every stock toggle writes an `auditLog`
row with the actor, the order number or SKU, and the before/after.

---

## Testing

**Unit** — `node:test`, no framework, tests co-located as `*.test.js`:

```bash
npm run check
```

**API** — a Postman collection in [`postman/`](postman/):

- `sugarloop-simple.postman_collection.json` — 36 plain requests for clicking through
- `sugarloop-api.postman_collection.json` — 111 requests, 726 assertions, for regression
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
  testing/      helpers for the integration suites — a private database per test file
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
| 8 Order status + stock toggles | ✅ |
| Customer phone OTP | ✅ pulled forward from sprint 2 — `POST /orders` is gated on it |
| 9 Geocoding + branch assignment | ✅ `POST /branches/resolve`, cached, provider-swappable |
| **10 Staging deploy** | ❌ **next** |

**Geocoding runs on OpenStreetMap until a Maps key exists.** That is a real quality gap,
not just a config placeholder: Nominatim resolves areas well (`DHA Phase 2 Islamabad`) but
not individual buildings (`Nadir Arcade` returns nothing), so some customers will be told
their address cannot be found and pushed to the location button instead. Switching to
Google is two lines in `.env` — see `GEOCODER` there. Lookups are cached for 90 days, so
Google's 10,000 free/month is far more than this shop will use.

Sprint 2 and beyond: WhatsApp Cloud API, SMS fallback, BullMQ status timers, the
unacknowledged-order escalation, PDF invoices, corporate enquiries, daily reports, admin
product CRUD, Cloudinary uploads.

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
