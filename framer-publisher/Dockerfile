# Sprint deploy-vps (2026-06-30) — Dockerfile del framer-publisher (Playwright).
#
# Diferente al backend porque este servicio SOLO corre Playwright para llenar
# el form público. Usa la imagen oficial de Playwright que ya viene con
# chromium + dependencias del sistema.
#
# Imagen: mcr.microsoft.com/playwright:v1.48-jammy (~500 MB, incluye chromium)

FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Copiar package files primero para cache eficiente
COPY package*.json ./
RUN npm ci

# Copiar código
COPY . .

# El publisher escribe la sesión Framer en /app/data (persistida vía volumen)
RUN mkdir -p /app/data && (id -u node >/dev/null 2>&1 || useradd -m -u 1001 node) && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4001/health', {headers:{'X-Publisher-Token': process.env.FRAMER_PUBLISHER_TOKEN}}, r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" || exit 1

# tsx en runtime para hot-loading TS sin build step (el servicio es chico)
CMD ["node", "--env-file=.env", "--import", "tsx", "src/server.ts"]
