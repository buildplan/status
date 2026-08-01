# STAGE 1: Builder
FROM dhi.io/node:26.5.1-alpine3.24-dev@sha256:d61d0e07a14c8a348fdd0da0df6ac824bd3d8545331d95d39f1b2bc65c2906bb AS builder

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
FROM dhi.io/node:26.5.1-alpine3.24@sha256:d4eebee600282f49e6b13f9421bf3305b677e72baa797f933f2cf8f7e58fe5a2

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
