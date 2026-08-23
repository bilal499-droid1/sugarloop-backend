# Sugarloop Backend

Ordering API for Sugarloop — a Cash-on-Delivery donut shop with four branches in
Islamabad. Node + Express + Mongoose + Zod on MongoDB, MVC layout, REST at `/api/v1`.

**Status: Sprint 1 feature-complete; runs locally.** A customer can browse the menu, be
quoted a price the server computed, **verify their phone by OTP**, and **place a
Cash-on-Delivery order**; a branch can then **work that order through to completion**,
toggle its own stock, and work the corporate gifting inbox. Order notifications fire on
every event that should send one.

⚠️ **This project is not deployed and is not being deployed for now.** There is
deliberately no CI, no Dockerfile and no hosting config in this repo — that is a decision,
not an omission, so please don't add any. `npm run check` is the gate.

One thing stands between this and real customers, and it is not code we can finish alone:

- **Nothing actually delivers a message.** WhatsApp needs the client's Meta Business
  account and per-template approval (1–3 days each, now **×8** — the escalation added
  `sugarloop_order_unacknowledged`); SMS needs a Twilio account. Until one exists,
  `OTP_TRANSPORT=log` and `NOTIFY_TRANSPORT=log` render to the console and send nothing,
  and the server refuses to boot in production on either.
  **This is calendar time, not dev time — start the application now.**

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
| `EMAIL_TRANSPORT` | `log` prints and sends nothing; `smtp` needs `SMTP_HOST/USER/PASSWORD`. Refused in production as `log` |
| `ENQUIRY_NOTIFY_EMAIL` | where corporate gifting enquiries land |
| `NOTIFY_TRANSPORT` | order notifications. `log` renders and sends nothing; `whatsapp` needs the Meta account. Refused in production as `log` |
| `ENQUIRY_NOTIFY_PHONE` | where the WhatsApp copy of an enquiry goes. Empty skips it; the email is unaffected |
| `REDIS_URL` | **optional.** Without it rate limits are per-process and unacknowledged orders are never chased |
| `ORDER_ESCALATION_MANAGER_MINUTES` / `_ADMIN_MINUTES` | how long an order may sit in `placed`. 5 and 10 |
| `ADMIN_ESCALATION_PHONE` | the second escalation rung. Falls back to `ENQUIRY_NOTIFY_PHONE` |

### Email (corporate gifting notifications)

Ships as `EMAIL_TRANSPORT=log`, which prints the message to the console and sends nothing.
That is the right default for development and is **refused at boot in production**, where
it would mean every corporate enquiry silently disappearing while the form kept promising
a reply.

Switching it on needs a Gmail **app password** — Gmail will not accept the account's real
password, whatever it is:

1. Sign in to the Sugarloop Google account → <https://myaccount.google.com/security>
2. Turn on 2-Step Verification. App passwords do not appear as an option until it is on.
3. <https://myaccount.google.com/apppasswords> → create one named e.g. "Sugarloop API"
4. Put the 16 characters in `SMTP_PASSWORD`, uncomment the `SMTP_*` block in `.env`, and
   set `EMAIL_TRANSPORT=smtp`

Then prove it before a customer depends on it:

```bash
npm run email:test                  # sends to ENQUIRY_NOTIFY_EMAIL
npm run email:test you@example.com  # or somewhere else
```

It prints the resolved config (never the password), sends a real message, and on failure
decodes the provider's error — `EAUTH` in particular is what Gmail returns both for a
wrong password *and* for using the account password instead of an app password, which the
raw message does not say.

The server refuses to start with `EMAIL_TRANSPORT=smtp` and any of host, user or password
missing, so a half-configured mailer is a container that will not boot rather than a lead
that vanishes.

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
npm run email:test   # proves the mailer works — see Email above
npm run lint
npm test             # node:test, no framework
npm run test:watch
npm run check        # lint + test — run this before every commit; there is no CI
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

POST /enquiries                      corporate gifting or an FAQ question — stored, then emailed
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

`POST /enquiries` takes `{ kind?, name, phone?, email, company?, subject?, message? }` and
serves two forms.

`kind: "corporate"` is the default and the gifting form: name, phone and email required,
everything else optional — a company typing a name, a number and "200 boxes for Eid" is a
lead worth having, and arguing with them about which box they left empty is not. The phone
rule is deliberately looser than the customer one used for orders: a corporate contact is
as likely to give a landline or a UAN as a mobile.

`kind: "question"` is the FAQ page's ask box. **The phone is optional and the message is
required**, which is the corporate rule turned around: a lead gets rung up, a question gets
answered by email, and demanding a number before somebody may ask whether the donuts
contain nuts loses more questions than the number could ever help answer.

Both land in the same collection and the same admin inbox, because they are the same shape
— somebody asked, somebody has to answer, and the answering has to be tracked. They carry
`kind` so the work can be told apart: `/staff/enquiries?kind=corporate` is the sales queue,
and an unlabelled list is how a 200-box lead ends up behind a fortnight of allergy
questions.

**Whichever kind it is, the lead is stored first and emailed second, and the email is not
allowed to fail the request.** SMTP goes down, inboxes filter, and a company asking about a 200-box order is
not something to lose to a spam folder. A send that fails leaves `emailedAt` null and logs
loudly — that is the flag for "nobody has been told about this one". Email needs
`EMAIL_TRANSPORT=smtp` and the four `SMTP_*` variables; the default `log` transport prints
the message and is refused at boot in production.

### Staff — `Authorization: Bearer <accessToken>`

```
POST /staff/auth/login               { email, password }
POST /staff/auth/refresh             refresh token is an httpOnly cookie
POST /staff/auth/logout
POST /staff/auth/logout-all
POST /staff/auth/password           { currentPassword, newPassword } — your own
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

GET    /staff/enquiries              admin only — ?status= &kind= &emailed= &search=
GET    /staff/enquiries/summary      counts per status + how many never emailed
GET    /staff/enquiries/:id
PATCH  /staff/enquiries/:id          { status?, note? }

GET    /staff/products               admin only — ?category= &isActive= &boxEligible= &search=
POST   /staff/products
GET    /staff/products/:id
PATCH  /staff/products/:id
DELETE /staff/products/:id           discontinues — never removes
```

Access tokens last 15 minutes; refresh tokens 7 days and rotate on every use.

**Two ways a password changes, and neither replaces the other.** `POST /staff/auth/password`
is the owner rotating their own and requires the current one — a 15-minute access token
found on an unlocked phone must not be enough to seize the account permanently.
`POST /staff/users/:id/password` is an admin reset and deliberately does *not*, because
the point is that the owner has lost it. Both revoke every existing session; the
self-service one issues a fresh session to the caller, so securing your account does not
sign you out of it.

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

### Unacknowledged orders

An order arrives, the branch is messaged, and nothing notices if nobody acts on it. On a
busy evening that is an order sitting in a queue while a customer waits for donuts nobody
started — the failure the order board exists to prevent, and the one it cannot prevent
alone, because a board only helps somebody who is looking at it.

Two delayed jobs per order: at **5 minutes** the branch is chased, at **10** the admin is
(`ORDER_ESCALATION_*_MINUTES`). Both are cancelled the moment the order leaves `placed` —
confirming it **is** the acknowledgement, so there is no separate "seen" button for
anyone to forget to press.

**The order's own status is the authority, not the job.** Every job re-reads the order
before sending and does nothing if it has moved. Cancellation is an optimisation on top of
that check, never a substitute: a job can already be running when the cancel lands, and
the API can restart between enqueue and fire. Chasing a manager about an order they
finished ten minutes ago erodes trust in the alert far faster than a missed one does.

The board polls every 15s and sounds a **repeating** chime while anything sits
unacknowledged — a single chime at the moment an order lands is missed by anyone who
stepped away, and then never sounds again for that order. It stops when somebody acts, not
when a timer expires. A phone in a kitchen during a rush is the thing least likely to be
looked at; the board is what somebody is actually in front of.

⚠️ **This needs an eighth WhatsApp template**, `sugarloop_order_unacknowledged`, which is
not among the seven the client was asked to submit. It cannot reuse
`sugarloop_new_order_staff`: Meta requires the body to match the approved template, and a
re-send would be indistinguishable from a duplicate anyway — the wrong signal for a chase.

The admin rung is configured (`ADMIN_ESCALATION_PHONE`) rather than looked up, because a
`StaffUser` carries no phone number. The manager rung uses the **branch** line, which
rings where the order is being made and reaches whoever is on shift.

### The catalogue

`/staff/products` is **admin only**, and a branch manager has no write to it at all. That
is the rule the pricing engine rests on: one global price list, with only availability
varying by shop. A manager who could edit a price could quietly undercut the other three.

**Prices are sent as paisa and nothing negotiates about it.** `29900` is Rs 299. The
validator rejects a float and rejects a string, and its message spells the conversion out,
because the mistake worth guarding against is not a typo — it is sending `299` and meaning
Rs 299. That is a valid integer and a real price of Rs 2.99; nothing downstream can tell
the difference, and the first sign would be the day's takings. The console shows rupees
and converts once, on submit.

**`DELETE` discontinues. Nothing here removes a document.** Every order line references a
product, and an order whose lines cannot resolve one is an order nobody can reprint,
refund or dispute. Discontinuing takes the item off the site everywhere — which is what
"delete" means to whoever clicked it — and `PATCH { isActive: true }` puts it back, which
is why there is no separate restore route. This is distinct from a stock toggle: that is
one branch saying the tray is empty today.

`sku` cannot be edited after creation. It is the key Nimbus POS maps against in Phase 2,
and changing it silently re-points that mapping at a different item. `slug` is derived
from the name when not supplied, and `legacyId` cannot be set at all — it exists only to
map the seeded 43 onto the numeric ids real localStorage carts are keyed by.

Every write is audited, and a price change is recorded in rupees as well as paisa:
`price: { from: 42900, to: 49900 }` is correct and unreadable when somebody is checking
the trail against a printed menu. An edit that changes nothing writes no row.

### Notifications

Six WhatsApp templates, wired to the events that fire them: an order placed messages the
customer **and** the branch that has to make it, and `out_for_delivery`,
`ready_for_pickup` and `completed` message the customer. A corporate enquiry pings the
admin alongside the email it already sends.

`confirmed` and `preparing` deliberately send nothing. They are kitchen bookkeeping, and a
shop that messages twice in five minutes to say "we have seen it" and then "we have started
it" trains customers to mute the number that later carries their OTP. `failed` is silent
too: it is the one status that needs a person explaining what happened and what the
customer gets instead, which the fail-reason form already prompts the branch to do.

**Nothing in `notification.service.js` is allowed to throw.** Every caller is a write that
already succeeded — the order is placed, the status has moved, the lead is stored. A send
that failed must not turn any of those into a 500, because the operator would then repeat
an action that already happened: a second transition on an order, or a customer told their
order failed while a rider is on the way. It swallows and logs, exactly as `audit.service`
does and for the same reason.

Delivery runs on `NOTIFY_TRANSPORT`, a swappable transport like OTP and email. `log`
renders the message to the console and is refused at boot in production — a shop whose
branches are never told an order arrived is an order nobody makes. `whatsapp` is the Meta
Cloud API and is **not implemented**: the six templates are Utility category and each needs
its own approval, which is the client's Meta Business account to obtain. It is a separate
switch from `OTP_TRANSPORT` on purpose — `sugarloop_otp` is Authentication category and
reviewed independently, so a working OTP flow should not wait on the slowest order
template.

What this does *not* do yet is record whether a message arrived. Meta reports that
asynchronously on the inbound webhook, which is the next piece of work; until it exists the
log stream is the record.

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
| 1 Skeleton | ✅ local — deployment is deliberately out of scope |
| 2 Models + seed | ✅ |
| 3 Catalogue endpoints | ✅ |
| 4 Hours engine | ✅ |
| 5 Pricing engine | ✅ |
| 6 Orders + numbering | ✅ |
| 7 Staff auth + RBAC | ✅ built ahead of order |
| 8 Order status + stock toggles | ✅ |
| Customer phone OTP | ✅ pulled forward from sprint 2 — `POST /orders` is gated on it |
| 9 Geocoding + branch assignment | ✅ `POST /branches/resolve`, cached, provider-swappable |
| Corporate enquiries + FAQ questions | ✅ public forms, admin inbox, per-kind queues |
| Order notifications | ✅ wired to every event — **the send itself is the stub** |
| Admin product CRUD | ✅ `/staff/products`, audited, discontinue-not-delete |
| Redis rate limits | ✅ falls back to in-memory without `REDIS_URL` |
| Unacknowledged-order escalation | ✅ 5 min → branch, 10 min → admin, plus the board's alarm |
| 10 Staging deploy | ⛔ out of scope, by decision |
| **WhatsApp / SMS send** | ❌ **next** — one function each, blocked on the Meta account |

**Geocoding runs on OpenStreetMap until a Maps key exists.** That is a real quality gap,
not just a config placeholder: Nominatim resolves areas well (`DHA Phase 2 Islamabad`) but
not individual buildings (`Nadir Arcade` returns nothing), so some customers will be told
their address cannot be found and pushed to the location button instead. Switching to
Google is two lines in `.env` — see `GEOCODER` there. Lookups are cached for 90 days, so
Google's 10,000 free/month is far more than this shop will use.

Sprint 2 and beyond: the WhatsApp Cloud API send itself, SMS fallback, the inbound webhook
and auto-reply, BullMQ status timers, the unacknowledged-order escalation, PDF invoices,
daily reports, admin product CRUD, Cloudinary uploads.

**Order notifications are wired and firing** — every event, every recipient, every
template, on the `log` transport. What is missing is one function: the HTTP call to Meta in
`notification.service.js`, which cannot be written against an account that does not exist.
See [Notifications](#notifications).

**Corporate enquiries are in, end to end.** `POST /enquiries` stores the lead and emails
the shop, the storefront form posts to it instead of opening a `mailto:` draft, and
`/staff/enquiries` is an admin-only inbox for working them: status, an appended note trail
that survives the lead passing between people, and a filter for the leads whose
notification email never sent — which exist in the database and nowhere else. There is
deliberately no create or delete on the staff side; leads arrive from the public form, and
removing one would erase the evidence that a company ever asked.

### Known gaps in the seeded data

- **Branch phone numbers** — all four share the single storefront line. Real per-branch
  numbers are still owed, and matter: every WhatsApp template ends with "call us on
  `<branch number>`".
- **NUST H-12 hours** — seeded 11:00–03:00 like the rest and **unconfirmed**. It trades
  inside a university building and is unlikely to keep those hours, so until the real ones
  arrive that branch will accept an order at 2am and the kitchen will not be there to make
  it. The schema is per-branch, so correcting it is one value; the seed now warns about it
  by name on every run rather than leaving it to a code comment.
- **Product images** — seeded empty. Blocked on moving Cloudinary to a client-owned
  account; `itemData.js` keeps the frontend asset names so the mapping is not lost.
- **Delivery coverage** — at 2 km the four branches cover ~48 km² of Islamabad. Not a
  gap: branches are independent by design and cover only their own radius, so an address
  no branch reaches is refused rather than stretched to. Listed here so the coverage is a
  known number, and because it is one field per branch to widen.

Background and client decisions live in [`docs/`](docs/).
