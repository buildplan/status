# STAGE 1: Builder
FROM node:26.3.0-alpine3.23@sha256:144769ec3f32e8ee36b3cfde91e82bee25d9367b20f31a151f3f7eea3a2a8541 AS builder

# Install build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm prune --omit=dev && npm cache clean --force

# STAGE 2: Runner
FROM node:26.3.0-alpine3.23@sha256:144769ec3f32e8ee36b3cfde91e82bee25d9367b20f31a151f3f7eea3a2a8541

# Setup Environment
ENV NODE_ENV=production
WORKDIR /app
ARG USER_ID=1000
ARG GROUP_ID=1000

RUN apk add --no-cache dumb-init tzdata \
    && deluser --remove-home node \
    && addgroup -g $GROUP_ID node \
    && adduser -u $USER_ID -G node -s /sbin/nologin -D node \
    && mkdir -p /app/data \
    && chown -R node:node /app \
    && rm -rf /sbin/apk /etc/apk /lib/apk /usr/share/apk /var/cache/apk

# Switch to non-root user
USER node

# Copy only necessary artifacts from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/package.json /app/server.js ./

# Expose ports (3000 = Public, 3001 = Admin)
EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
