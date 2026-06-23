# STAGE 1: Builder
FROM dhi.io/node:26.3.1-alpine3.24-dev@sha256:84d3115516eaeb393c047443eb7a82a635693df3692279b1dcf50d338d8f10ea AS builder

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
FROM dhi.io/node:26.3.1-alpine3.24@sha256:4b7adfdd27acc35ff28c8d82fc004b3d0006ee227b83e97e73f2b04f8c459221

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
