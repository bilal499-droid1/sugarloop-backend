# syntax=docker/dockerfile:1
#
# The Sugarloop API and storefront.
#
# One container, one origin: Express serves the built shop and the API sits under
# /api/v1 of the same host. That removes the second host and, with it, the CORS problem —
# see README > Deployment. CORS_ORIGINS must still be set, because config/env.js refuses
# to boot on an empty one outside development, but no customer request is cross-origin.
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Dependencies before source, so an ordinary code change reuses the cached install
# instead of refetching every package. `npm ci` installs exactly the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# The built storefront. `npm run build:web` must have been run first — it wipes public/
# and copies a fresh Vite build in from ../roots-international. Stale or missing, and this
# ships yesterday's shop or none at all: app.js serves public/ when it exists and falls
# back to API-only when it does not, so a forgotten build fails quietly, not loudly.
#
# public/ is gitignored, so it does not arrive with a `git pull` on the server — copy it
# up (scp) or build the image where the frontend repo is.
COPY public ./public

# node:alpine ships an unprivileged `node` user. Running as root inside a container that
# faces the internet buys nothing and makes a bug in the app root on this filesystem.
USER node

EXPOSE 4000

# Node is PID 1 here, which means it receives only the signals it has handlers for —
# and `server.js` installs SIGTERM and SIGINT explicitly, so no init shim is needed.
#
# ⚠️ Shutdown allows itself 15 seconds to drain in-flight requests. Docker's default stop
# timeout is 10, which kills it mid-drain — that is an order taken and never written.
# Run with `--stop-timeout 20`, or `stop_grace_period: 20s` in compose.
STOPSIGNAL SIGTERM

# Liveness, not readiness, deliberately: `/ready` reports 503 when Mongo is unreachable,
# and restarting the container over a database blip cures nothing and drops live traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
