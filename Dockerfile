# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Directories the server writes to
RUN mkdir -p evidence logs && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000 3003

# Default: main agent server. Override CMD in compose for qa-server.
CMD ["node", "src/server.js"]
