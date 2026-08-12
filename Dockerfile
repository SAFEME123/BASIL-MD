# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# ---------- Build stage ----------
FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

# Build-time only: compilers + dev headers for native addons (canvas, sharp,
# sqlite3, better-sqlite3). None of this ships in the final image.
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    sqlite-dev \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev \
    pixman-dev \
    freetype-dev \
    harfbuzz-dev \
    fribidi-dev \
    fontconfig-dev

COPY package*.json ./
# node-gyp is pinned via package.json "overrides" (fixes the rimraf/node-gyp
# "rm is not a function" incompatibility) — no Docker-level workaround needed.
RUN npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

# ---------- Runtime stage ----------
FROM node:${NODE_VERSION}-alpine AS runtime

WORKDIR /app

# Runtime-only: actual binaries/shared libs the bot calls at runtime.
# No compilers, no -dev headers — keeps the final image lean.
RUN apk add --no-cache \
    sqlite-libs \
    ffmpeg \
    imagemagick \
    libwebp-tools \
    curl \
    cairo \
    pango \
    libjpeg-turbo \
    giflib \
    pixman \
    freetype \
    harfbuzz \
    fribidi \
    fontconfig

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
# Copy only the public entry point — the encrypted bundle downloads the rest
COPY start.js ./

RUN mkdir -p data temp session assets

ENV NODE_ENV=production
ENV BASIL_PROXY_MEDIA=false
ENV PORT=3028

# TZ is read by Node.js and the OS for all date/time operations.
# Defaults to UTC. Override by setting TIME_ZONE in your deployment env vars.
ARG TIME_ZONE=Africa/Harare
ENV TZ=${TIME_ZONE}

EXPOSE 3028

# Health check — actually hit the /health endpoint exposed by index.js
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT:-3028}/health" || exit 1

CMD ["node", "start.js"]
