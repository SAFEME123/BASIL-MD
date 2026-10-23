# Public deployment image: generate start.js with the owner release flow first.
# Keep the public start.js -> remote loader -> encrypted ZIP -> index.js chain.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app

# glibc supports node-canvas prebuilt binaries; headers permit source fallback.
# Retain existing bot media/native requirements without changing npm dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git python3 make g++ pkg-config \
    sqlite3 libsqlite3-dev ffmpeg imagemagick webp curl tzdata \
    libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev \
    libpixman-1-dev libfreetype6-dev libharfbuzz-dev libfribidi-dev \
    libfontconfig1-dev libvips-dev fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Preserve legacy-peer-deps compatibility and explicitly retain optional renderers.
# Prefer a reproducible lockfile; do not silently regenerate a mismatched lockfile.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --include=optional --no-audit --no-fund --legacy-peer-deps; \
    else \
      npm install --omit=dev --include=optional --no-audit --no-fund --legacy-peer-deps; \
    fi

# Public bootstrap and non-secret helper files only; NEVER COPY . .
COPY start.js ./
COPY lib/canvas-compat.cjs ./lib/canvas-compat.cjs
COPY lib/canvas-preload.cjs ./lib/canvas-preload.cjs
RUN mkdir -p data temp session assets

ENV NODE_ENV=production \
    BASIL_PROXY_MEDIA=false \
    PORT=3028 \
    NODE_OPTIONS=--require=/app/lib/canvas-preload.cjs
ARG TIME_ZONE=Africa/Harare
ENV TZ=${TIME_ZONE}
EXPOSE 3028
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT:-3028}/health" || exit 1
CMD ["node", "start.js"]
