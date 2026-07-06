FROM node:20-slim

# Chromium + dependencias para Puppeteer (whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_CACHE_DIR=/root/.cache/puppeteer

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
RUN npx puppeteer browsers install chrome

COPY prisma ./prisma
RUN npx prisma generate

COPY dist ./dist

# Directorio para logs persistentes (montado como volumen en producción)
RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "dist/index.js"]
