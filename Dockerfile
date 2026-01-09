# STAGE 1: Builder
FROM node:25-alpine AS builder

# Install build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./
RUN npm ci --omit=dev

# STAGE 2: Runner
FROM node:25-alpine

# Install runtime requirements
RUN apk add --no-cache dumb-init tzdata

ENV NODE_ENV=production
WORKDIR /app

# Setup non-root user
ARG USER_ID=1000
ARG GROUP_ID=1000

RUN deluser --remove-home node \
    && addgroup -g $GROUP_ID node \
    && adduser -u $USER_ID -G node -s /bin/sh -D node

# Setup data directory with permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user
USER node

# Copy built node_modules from builder stage
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Copy necessary application source files
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node views ./views

# Expose ports (3000 = Public, 3001 = Admin)
EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
