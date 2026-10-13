# syntax=docker/dockerfile:1

# AdGuard Atlas — multi-stage build.
#
#   docker build -t adguard-atlas .                       the runtime image
#   docker build --target check .                         type check, lint, tests
#   docker build --target demo -o demo-dist .             the static demo, as files
#
# Nothing is installed on the build host: every step runs in a container.

ARG NODE_VERSION=22

# --- dependencies ---------------------------------------------------------------
# Everything up to the runtime stage produces platform-independent output (bundled
# JavaScript, a data file), so it runs once on the build machine's own architecture
# and a multi-platform build only emulates the runtime stage.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# --- sources ----------------------------------------------------------------------
FROM deps AS source
COPY tsconfig.json vite.config.ts vitest.config.ts eslint.config.js ./
COPY src ./src
COPY test ./test

# --- type check, lint, tests ------------------------------------------------------
FROM source AS check
RUN npm run typecheck
RUN npm run lint
RUN npm run test

# --- server and front end ---------------------------------------------------------
FROM source AS build
RUN npm run build

# --- static demo (F27): plain files, no server --------------------------------------
FROM source AS demo-build
RUN npm run build:demo

FROM scratch AS demo
COPY --from=demo-build /app/dist/demo /

# --- GeoIP database (D3) ------------------------------------------------------------
# DB-IP City Lite (CC BY 4.0), downloaded at build time and never stored in git.
# The file is published monthly; the current month is tried first, then the previous
# one. GEOIP_URL overrides the location. GEOIP=skip builds an image without a
# database (for offline builds): such an image only locates anything when a
# database is mounted and GEOIP_DB points at it.
FROM --platform=$BUILDPLATFORM alpine:3.24 AS geoip
ARG GEOIP=download
ARG GEOIP_URL=""
RUN set -eu; \
    mkdir -p /geoip; \
    if [ "$GEOIP" = "skip" ]; then \
      echo "GEOIP=skip: building WITHOUT a GeoIP database" >&2; \
      exit 0; \
    fi; \
    this_month="$(date -u +%Y-%m)"; \
    last_month="$(date -u -d "$(date -u +%Y-%m-01) -1 day" +%Y-%m 2>/dev/null || true)"; \
    for url in "$GEOIP_URL" \
               "https://download.db-ip.com/free/dbip-city-lite-${this_month}.mmdb.gz" \
               "https://download.db-ip.com/free/dbip-city-lite-${last_month}.mmdb.gz"; do \
      [ -n "$url" ] || continue; \
      echo "Fetching $url"; \
      if wget -q -T 60 -O /tmp/db.mmdb.gz "$url" && gunzip -t /tmp/db.mmdb.gz; then \
        gunzip -c /tmp/db.mmdb.gz > /geoip/dbip-city-lite.mmdb; \
        rm /tmp/db.mmdb.gz; \
        echo "$url" > /geoip/SOURCE; \
        ls -l /geoip; \
        exit 0; \
      fi; \
    done; \
    echo "ERROR: the GeoIP database could not be downloaded." >&2; \
    echo "       Pass --build-arg GEOIP_URL=<url of an .mmdb.gz> or --build-arg GEOIP=skip." >&2; \
    exit 1

# --- runtime ------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
# The image needs node and nothing else: no package manager, no shell tooling to keep patched.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm /tmp/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    GEOIP_DB=/usr/share/geoip/dbip-city-lite.mmdb
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/web ./dist/web
COPY --from=geoip /geoip /usr/share/geoip
COPY LICENSE NOTICE.md ./
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server/main.cjs"]
