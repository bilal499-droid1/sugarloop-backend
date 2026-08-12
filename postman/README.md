# Sugarloop API — Postman collection

47 requests, 310 assertions, covering every endpoint that currently exists.

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

Expect **310/310 passing**. A run takes about 6 seconds.

## Run it top to bottom

Requests share state through collection variables: folder 1 saves `branchId` and
`branchCode`, folder 2 saves `productSlug`, folder 3 saves `accessToken` and
`managerToken`. Running a single request in isolation may fail purely because a variable
is still empty — that is the collection's design, not a broken endpoint.

## What is covered

| Folder | Checks |
|---|---|
| 0 · Health | liveness, readiness, the `{ data }` envelope |
| 1 · Branches | all 4, `{ lat, lng }` (not the GeoJSON array), server-computed `isOpenNow` vs `isAcceptingOrders`, one clock across the whole response |
| 2 · Catalogue | 43 products, price sum **1,819,500 paisa**, all category counts, filters, per-branch `inStock`, and that no `publicId` / FBR field / internal leaks |
| 3 · Staff auth | login, `/me`, refresh rotation, manager login, no password hash in any payload |
| 4 · Staff users | full admin CRUD, soft delete, password policy |
| 5 · Authorisation | 401 without a token, 403 for a manager hitting admin-only routes, no account enumeration on login |
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
- **Folder 6 asserts `/checkout/quote` returns 404.** That is deliberate — it documents the
  edge of what is built. When the pricing engine lands, that test will fail, which is the
  reminder to extend this collection.

## Not built yet

These will 404, by design: `/checkout/quote`, `/orders`, `/auth/otp/*`, `/enquiries`,
`/staff/orders`, `/staff/stock`, `/staff/products`, `/staff/reports`.
