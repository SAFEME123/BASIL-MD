# Use Node.js 20 LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    sqlite-dev \
    ffmpeg \
    imagemagick \
    libwebp-tools \
    curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production --no-audit --no-fund

# Copy only the public entry point — the encrypted bundle downloads the rest
COPY start.js ./

# Create necessary directories
RUN mkdir -p data temp session assets

# Set environment variables
ENV NODE_ENV=production
ENV BASIL_PROXY_MEDIA=false
ENV PORT=3028
# TZ is read by Node.js and the OS for all date/time operations.
# Defaults to UTC. Override by setting TIME_ZONE in your deployment env vars.
ARG TIME_ZONE=UTC
ENV TZ=${TIME_ZONE}

# Expose port (matches the app default in index.js)
EXPOSE 3028

# Health check — actually hit the /health endpoint exposed by index.js
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT:-3028}/health" || exit 1

# Start the application
CMD ["node", "start.js"]