# Sistema Varone

Monitor autónomo de piratería del asfalto en rutas argentinas para Varone. WhatsApp + 6 portales policiales → IA → moderación humana → publicación en `pirateriadecamiones.com.ar`.

## 🚨 Si sos nuevo en este proyecto — leé PRIMERO

**👉 [HANDOFF-NUEVO-DEV.md](./HANDOFF-NUEVO-DEV.md)** — instrucciones para deployar el sistema a un VPS con Supabase.

Después:

- **[CLAUDE.md](./CLAUDE.md)** — contexto técnico completo del producto
- **[DEPLOY.md](./DEPLOY.md)** — guía paso a paso deploy VPS
- **[OPERATIONS.md](./OPERATIONS.md)** — runbook operaciones diarias

## Stack

- Backend: TypeScript / Node.js 20 / Express / Prisma / PostgreSQL
- IA: Google Gemini (con retries) + OpenAI fallback
- WhatsApp: `whatsapp-web.js` (Puppeteer)
- Publisher: Playwright (form-fill del sitio público)
- Frontend: Next.js 15 + Tailwind + Leaflet (mapa)
- Deploy: Docker Compose + nginx-proxy + Let's Encrypt

## Comandos rápidos

```bash
# Dev local
docker start sistema-varone-db-1                    # DB
cd products/sistema-varone && npm run dev           # backend :3000
cd varone-admin && npm run dev                      # admin :3001
cd framer-publisher && npm run dev                  # publisher :4001

# Tests
npm run test        # vitest
npx tsc --noEmit    # typecheck

# Deploy VPS
# Ver DEPLOY.md
```

## Estado actual (2026-06-30)

- ✅ Código en `main`, 73/73 tests passing
- ✅ Dockerfiles + docker-compose.prod.yml listos para VPS
- ✅ Panel `/configuracion` para admin (toggles portales + editar grupo WA)
- 🟡 Pendiente: migración a Supabase + deploy real al VPS
- 🟡 Pendiente: smoke E2E con Varone en producción
