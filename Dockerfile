# Multi-stage Node build for Fly.io. Intent: small, non-root runtime image with
# only production deps installed. No build step — this is CommonJS, no transpile.
# EJS views + public assets are copied in; the SQLite DB file and uploads live on
# a persistent volume (see fly.toml + FLY.md), so they are NOT in this image.

# ---- deps ----
FROM node:24-slim AS deps
WORKDIR /app
# Copy lockfile + manifest first for layer caching.
COPY package.json package-lock.json ./
# --legacy-peer-deps: the lockfile has a dev-only peer conflict
# (@babel/preset-env@8 wants @babel/core@^8; lockfile pins core@7). It's a test
# dependency and --omit=dev discards it from the final image anyway — this flag
# just lets resolution proceed past the conflict during the build.
RUN npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps

# ---- runtime ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root user — Fly runs containers as root by default; running as a limited
# user is cheap defense-in-depth. The /data volume is chowned to this user below.
RUN groupadd --system --gid 1001 incblog \
  && useradd --system --uid 1001 --gid incblog --home-dir /app --shell /usr/sbin/nologin incblog

# Production deps from the deps stage.
COPY --from=deps --chown=incblog:incblog /app/node_modules ./node_modules

# App source. .dockerignore drops node_modules, tests, .env, the local DB, and
# existing uploads (those belong on the volume, not baked into the image).
COPY --chown=incblog:incblog package.json app.js ./
COPY --chown=incblog:incblog src ./src

# Create the volume mountpoint with correct ownership. fly.toml mounts a volume
# here; mkdir ensures it exists for local `docker run` without a volume, and the
# chown survives the volume attach only if the volume is empty (first deploy).
RUN mkdir -p /data/uploads && chown -R incblog:incblog /data

USER incblog
EXPOSE 3000

# session->PORT is set by Fly. Run as the non-root user.
CMD ["node", "app.js"]
