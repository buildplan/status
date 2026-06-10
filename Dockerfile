# STAGE 1: Builder
FROM dhi.io/node:26.3.0-alpine3.23-dev@sha256:91d9154ee02f91eaa8e4833e724a13d4812b61d95c0a01abaa2ce0a01ca9f077 AS builder

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
FROM dhi.io/node:26.3.0-alpine3.23@sha256:06d198004a7b868a1d1931cfe86b9efca6f048d47e7cd4c15784f1fe1f1cc195

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
