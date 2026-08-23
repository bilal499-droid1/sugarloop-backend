# Sugarloop API — Postman collection

139 requests, 896 assertions, covering every endpoint that currently exists.

## Import

1. Postman → **Import** → both files in this folder:
   - `sugarloop-api.postman_collection.json`
   - `sugarloop-local.postman_environment.json`
2. Select **Sugarloop — Local** in the environment dropdown (top right).
3. Set `adminPassword` in that environment to the seeded staff password.

## Getting the password

`npm run seed` prints it **once**, on the run that creates the accounts:

```
WARN: Generated staff password (shown once): dev-xxxxxxxxxxxx
```

If you missed it, set your own and re-seed from scratch:

```bash
SEED_ADMIN_PASSWORD='YourPassword123!' npm run seed -- --fresh
```

All five seeded accounts share that password — `admin@sugarloop.pk` and the four
`dhaN.manager@sugarloop.pk`. `--fresh` drops and recreates, and is refused outside
development.

## Run it

Start the API first (`npm run dev`), then either:

- **Postman** → collection → **Run** → Run Sugarloop API
- **CLI**:
  ```bash
  npm run test:api -- --env-var "adminPassword=YOUR_PASSWORD"
  ```

Expect **896/896 passing**. A clean run takes about 15–17 seconds.

## Run it top to bottom

Requests share state through collection variables: folder 1 saves `branchId` and
`branchCode`, folder 2 saves `productSlug` and the product ids, folder 2c verifies a
customer phone first (`customerOtpCode`, then `customerToken`) and saves `orderNumber`,
folder 2d verifies a *second* phone the same way (`failCustomerToken`) before placing its
own order, signs in and saves `orderId`, folder 3 saves `accessToken` and `managerToken`,
folder 4 saves `qaStaffId` and — for the self-service password change — `qaAccessToken`,
signing in as its own throwaway QA account rather than touching a seeded one. Running a
single request in isolation may fail purely because a variable is still empty — that is
the collection's design, not a broken endpoint.

Folders 2d and 2e sit before folder 3 because they work the order folder 2c just placed,
so they sign in for themselves rather than borrowing the tokens folder 3 captures.

## What is covered

| Folder | Checks |
|---|---|
| 0 · Health | liveness, readiness, the `{ data }` envelope |
| 1 · Branches | all 4, `{ lat, lng }` (not the GeoJSON array), server-computed `isOpenNow` vs `isAcceptingOrders`, one clock across the whole response |
| 2 · Catalogue | 43 products, price sum **Rs 18,195**, all category counts, filters, per-branch `inStock`, and that no `publicId` / FBR field / internal leaks |
| 2b · Checkout quote | server-side pricing, box rules, the Rs 500 minimum, the Rs 100 delivery fee, the delivery radius, and a client-sent `price` being ignored |
| 2c · Orders | placement is refused without a verified phone (`PHONE_NOT_VERIFIED`), the OTP request → `devCode` → verify round trip, then placement, `SL-YYMMDD-NNNN` numbering, re-pricing and `PRICE_CHANGED`, phone-guarded lookup |
| 2d · Staff order board | the full state machine — the happy path to `completed`, every refusal (skip-ahead, backwards, terminal, wrong handover for the fulfilment), `failed` with mandatory reason codes, COD completion setting `payment.status: collected`, the staff-vs-customer view split, and the `status` / `fulfilment` / `date` / `phone` filters |
| 2e · Stock toggles | the per-branch sheet including never-toggled products, idempotent `PATCH`, the toggle propagating to the public menu and to checkout, and NOT propagating to another branch |
| 2f · Corporate enquiries | the gifting form — a lead stored and emailed, a landline accepted where an order would refuse one, the three required fields, and that the receipt echoes nothing back |
| 3 · Staff auth | login, `/me`, refresh rotation, manager login, no password hash in any payload |
| 4 · Staff users | full admin CRUD, soft delete, password policy, and the self-service password change (`POST /staff/auth/password`) — wrong current password, new-equals-current, and the short-password check, run against a throwaway QA account it signs into for itself |
| 4b · Enquiries inbox | the admin-only lead inbox — list, the counts behind the filter chips, the `emailed=false` filter that finds leads whose notification never sent, status changes with an attributed note, notes accumulating rather than replacing, and a branch manager refused (403) |
| 5 · Authorisation | 401 without a token, 403 for a manager hitting admin-only routes, branch scoping — a manager refused another branch's orders (403) and another branch's single order (404), no account enumeration on login |
| 6 · Errors | 404 vs 422 on every bad input, error envelope shape |
| 7 · Sign out | logout, and refresh genuinely failing afterwards |

Every request also inherits four collection-level assertions: JSON content type, an
`x-request-id` for log correlation, no `x-powered-by`, and not rate limited.

## Notes

- **429s** mean you re-ran too quickly. The general limiter is 300/min and login is
  20 per 15 minutes counting failures only. Wait a minute.
- **Folder 4 creates a staff user each run**, with a timestamped email, and deactivates it
  at the end. Deactivation is a soft delete, so these accumulate in `staffUsers`. Harmless;
  clear them with `npm run seed -- --fresh` when it bothers you.
- **The refresh test depends on the cookie jar.** The refresh token is httpOnly and scoped
  to `/api/v1/staff/auth`. Postman and newman both handle this; a raw `curl` would need
  `-c/-b` or the token in the body.
- **Folders 2c and 2d place three orders per run** and work two of them to a terminal
  state. They accumulate in `orders` and consume order numbers for the day. Harmless — the
  sequence is date-scoped and four digits carries 9,999 a day.
- **Folder 2e leaves the database as it found it.** It marks an item sold out, checks that
  the public menu and checkout both agree, then puts it back, so the collection is
  re-runnable. Run it twice in a row to confirm.
- **Two customer phones get verified per run** — `03001234567` in folder 2c,
  `03009876543` in folder 2d — each via a real `POST /auth/otp/request` →
  `POST /auth/otp/verify` round trip, reading the code back from `devCode` (only present
  when `OTP_TRANSPORT=log` outside production, which is what `npm run dev` uses). The
  session comes back as a bearer token in the response body, not just the httpOnly
  cookie, specifically so a client with no cookie jar can carry it — newman sends it as
  `Authorization: Bearer {{customerToken}}` on every order-placing request that needs it.
- **The per-phone OTP cap is 3 codes/hour and is NOT relaxed in development** (unlike the
  per-IP `otpLimiter`, which is). Three runs of the full collection inside one hour is
  fine; a fourth will fail its OTP request step with `OTP_RATE_LIMITED` for both phones.
  Same fix as any other rate limit here — wait, or restart the API to drop nothing (this
  one lives in Mongo, not memory, so a restart doesn't clear it; `npm run seed -- --fresh`
  does, since it drops the whole database).

## Not built yet

These will 404, by design: `/staff/products`, `/staff/reports`.
