# STAGE 1: Builder
FROM dhi.io/node:26.5.0-alpine3.24-dev@sha256:7baafaf015c3e137546e0b001fbc2f3f3e0d6de3ad06d1e702fcb744302107e4 AS builder

# Install build and runtime tools
RUN apk add --no-cache python3 make g++ dumb-init tzdata

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm prune --omit=dev && npm cache clean --force
RUN mkdir -p /app/data && chown -R 1000:1000 /app/data

# STAGE 2: Runner
FROM dhi.io/node:26.5.0-alpine3.24@sha256:54bbd76f445f53dda9ecc0f303e7f1e31a2c8ea96639fbb138621aeb8ff4d9a4

ENV NODE_ENV=production
WORKDIR /app

USER 1000

# Copy system-level binaries and data from the builder stage
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /usr/bin/dumb-init /usr/bin/dumb-init

# Copy the pre-permissioned empty data directory
COPY --from=builder --chown=1000:1000 /app/data ./data

# Copy application artifacts
COPY --from=builder --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/src ./src
COPY --from=builder --chown=1000:1000 /app/package.json /app/server.js ./

EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
