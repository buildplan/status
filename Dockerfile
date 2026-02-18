# STAGE 1: Builder
FROM node:25.6.1-alpine@sha256:b9b5737eabd423ba73b21fe2e82332c0656d571daf1ebf19b0f89d0dd0d3ca93 AS builder

# Install build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci
COPY . .
RUN cp node_modules/sortablejs/Sortable.min.js public/Sortable.min.js
RUN npm run build:css
RUN npm prune --omit=dev && npm cache clean --force

# STAGE 2: Runner
FROM node:25.6.1-alpine@sha256:b9b5737eabd423ba73b21fe2e82332c0656d571daf1ebf19b0f89d0dd0d3ca93

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
COPY --chown=node:node src ./src
COPY --chown=node:node views ./views
COPY --chown=node:node package.json server.js ./

# Expose ports (3000 = Public, 3001 = Admin)
EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
