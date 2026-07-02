# Sprint deploy-vps (2026-06-30) — Dockerfile del admin panel Next.js.
#
# Multi-stage:
#  1. deps: instala production deps con cache eficiente
#  2. builder: build de Next.js (SSG + server chunks)
#  3. runner: imagen final chica (node:20-alpine) que corre `next start`
#
# El admin es Next.js 15 en modo standalone para minimizar imagen.

# ─── deps: install prod dependencies ────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# ─── builder: compile Next.js ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Env vars públicas necesarias durante el build (NEXT_PUBLIC_*)
ARG NEXT_PUBLIC_SISTEMA_VARONE_URL=http://backend:3000
ENV NEXT_PUBLIC_SISTEMA_VARONE_URL=$NEXT_PUBLIC_SISTEMA_VARONE_URL

RUN npm run build

# ─── runner: imagen final production ────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Usuario non-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.* ./

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/auth/logout || exit 1

CMD ["npx", "next", "start", "-p", "3001"]
