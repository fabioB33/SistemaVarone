# ---- builder: compila TypeScript -> dist (self-building, fix DEBT COPY dist) ----
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
# tsc emite dist aunque haya type-errors tolerados historicamente en el repo
RUN npm run build || true
# guard: si dist NO se emitio, fallar el build (evita atajo silencioso)
RUN test -f dist/index.js

# ---- runtime ----
FROM node:20-slim
RUN apt-get update && apt-get install -y \
    chromium libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_CACHE_DIR=/root/.cache/puppeteer
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN npx puppeteer browsers install chrome
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
RUN mkdir -p logs
EXPOSE 3000
CMD ["sh", "-c", "find /app/.wwebjs_auth -name 'Singleton*' -delete 2>/dev/null; exec node dist/index.js"]
