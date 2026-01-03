# 1. Use the lightweight Alpine Node image
FROM node:24-alpine

# 2. Best Practice: Install 'dumb-init'
# Node.js runs as PID 1 by default in Docker, which means it doesn't handle 
# kill signals (SIGTERM) correctly. 'dumb-init' fixes this.
# --- ADDED: python3, make, g++ for better-sqlite3 compilation ---
RUN apk add --no-cache dumb-init python3 make g++

# 3. Set Environment to Production
# This optimizes Express.js performance and disables verbose dev warnings
ENV NODE_ENV=production

# 4. Set the working directory
WORKDIR /app

# 5. Create the data directory and set permissions
# We must ensure the non-root 'node' user owns /app and /app/data 
# BEFORE we switch users.
RUN mkdir -p /app/data && chown -R node:node /app

# 6. Switch to the built-in non-root user 'node'
USER node

# 7. Copy package files first (Layer Caching optimization)
# Using --chown=node:node ensures the user can read/write them
COPY --chown=node:node package*.json ./

# 8. Install dependencies cleanly
# --- CHANGED: 'npm ci' -> 'npm install' (creates lockfile) ---
# --- ADDED: --build-from-source (ensures sqlite builds correctly) ---
RUN npm install --production --build-from-source && npm cache clean --force

# 9. Copy the rest of the application code
COPY --chown=node:node . .

# 10. Expose the application port
EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "server.js"]
