# STAGE 1: Builder
FROM node:24-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# STAGE 2: Runner
FROM node:24-alpine

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

ARG USER_ID=1000
ARG GROUP_ID=1000

RUN deluser --remove-home node \
    && addgroup -g $GROUP_ID node \
    && adduser -u $USER_ID -G node -s /bin/sh -D node

RUN mkdir -p /app/data && chown -R node:node /app

USER node

COPY --from=builder --chown=node:node /app/node_modules ./node_modules

COPY --chown=node:node . .

# Expose ports public+admin
EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
