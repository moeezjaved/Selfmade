# Selfmade Creative Worker — Playwright + Chromium on Debian
# Use the official Playwright image to skip the painful system-deps install.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Install deps first (cache-friendly)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npm install --save-dev typescript @types/node && \
    npx tsc && \
    npm prune --omit=dev

# Resource defaults — tune at runtime via env vars
ENV WORKER_CONCURRENCY=8 \
    WORKER_BATCH_SIZE=50 \
    NODE_ENV=production

# No exposed port — worker doesn't serve HTTP
CMD ["node", "dist/index.js"]
