# syntax=docker/dockerfile:1
#
# The Sugarloop API.
#
# The API only. The storefront is deployed separately on Vercel and talks to this over
# CORS; see README > Deployment for the origin and cookie settings that pairing needs.
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Dependencies before source, so an ordinary code change reuses the cached install
# instead of refetching every package. `npm ci` installs exactly the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# The storefront is served by Vercel, so this image is the API alone. If the two are ever
# consolidated onto this box, run 'npm run build:web' and uncomment the next line —
# app.js already serves public/ when it exists and stays API-only when it does not.
# COPY public ./public

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
