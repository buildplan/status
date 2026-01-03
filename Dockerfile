FROM node:24-alpine

RUN apk add --no-cache dumb-init python3 make g++

ENV NODE_ENV=production

WORKDIR /app

RUN mkdir -p /app/data && chown -R node:node /app

USER node

COPY --chown=node:node package*.json ./

RUN npm install --production --build-from-source && npm cache clean --force

COPY --chown=node:node . .

# Expose Public AND Admin ports
EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "server.js"]
