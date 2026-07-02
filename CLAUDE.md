# Sistema Varone — Road Safety Monitor

> [!important] 🎯 Si sos Claude Code y es tu primera vez en este proyecto
> **Leé [HANDOFF-NUEVO-DEV.md](./HANDOFF-NUEVO-DEV.md) ANTES de tocar nada.**
> Ese documento tiene el contexto de negocio + los pasos para deployar
> el sistema a un VPS con Supabase. Este `CLAUDE.md` es el contexto
> técnico complementario.

> [!danger] Reglas universales Pampa Labs OS aplicables aquí (heredadas del CLAUDE.md raíz)
> Las **11 reglas absolutas** del CLAUDE.md raíz aplican tal cual. Las dos más críticas:
> - **Regla #9 NO-HARDCODED:** PROHIBIDO hardcodear números WhatsApp, group IDs, prompt template, account IDs, URLs Framer prod, env vars. Schema-driven + env vars siempre.
> - **Regla #10 VAULT-LOOKUP-BEFORE-INSTRUCT:** ANTES de cada respuesta mencionando paths, services, env vars, group IDs, sprint numbers → ejecutar grep al vault + pegar bloque visible `[VAULT-CHECK pre-respuesta]`.
>
> Ver [[../../docs/vault/lessons-learned/LL-2026-05-09-no-hardcoded-law-pampa-labs]] + [[../../docs/vault/lessons-learned/LL-2026-05-09-vault-lookup-before-instruct]].

---

## Qué es

Sistema de monitoreo automatizado de seguridad vial que detecta y trackea incidentes de "piratas del asfalto" (robos de carga, asaltos, bloqueos) en rutas argentinas. Opera 24/7 escuchando un grupo de WhatsApp y procesando los mensajes con IA para alimentar un panel de aprobación humana antes de publicar.

## Cómo funciona (post-Sprint pivot-framer-form 2026-06-26 + hardening 2026-06-27)

```
WhatsApp Agent (tiempo real, grupo "Piratería de Camiones")
                   │
                   ▼
            Pipeline Service
            (cola FIFO, enriquece URL si tiene link)
            + spike detector persistente en DB
                   │
                   ▼
         AI Service (Gemini + retries exponential backoff)
            ¿Es relevante?
           /              \
         NO               SÍ
       Descarta      Dedup Service (SHA256 + URL)
                     ¿Duplicado?
                    /           \
                  SÍ            NO
               Descarta    Enum-matcher fuzzy (10 dropdowns canonical)
                                │
                          ¿Todos los campos OK?
                          /              \
                         NO              SÍ
              registro:pendiente_revision  registro:pendiente
                  (badge amber)              (notif Varone WA)
                          │                          │
                          ▼                          ▼
                Panel admin Next.js (:3001)
                ├── /pendientes-revision (form de dropdowns faltantes)
                ├── /aprobacion (aprobar / descartar / despublicar)
                ├── /errores-publicacion (reintentar / descartar fallos)
                ├── /mapa (visualización geográfica Leaflet)
                │
                ▼
       Aprobado → enviarAFramer()
                          │
                          ▼
         framer-publisher v2 (:4001, Playwright)
         login + llena form público + submit
                          │
                          ▼
       pirateriadecamiones.com.ar (auto-rebuild Framer)
       estado=publicado | fallo_publicacion (badge rojo)
```

## Los 3 servicios (no confundir puertos)

| Puerto | Qué es | Quién lo usa |
|---|---|---|
| `:3000` | **Backend Express** sin UI (API + lógica + DB + WA agent) | Frontend `:3001` consume vía X-Backend-Token |
| `:3001` | **Admin panel Next.js** con UI (login, /aprobacion, /pendientes-revision, /errores-publicacion) | **Varone abre acá en browser** |
| `:4001` | **Framer publisher** Playwright (form filler) | Backend `:3000` lo invoca para postear |

El sitio público `pirateriadecamiones.com.ar` **NO está en estos puertos** — vive en Framer.

## Stack

| Capa | Tecnología |
|------|-----------|
| Lenguaje | TypeScript (strict mode) |
| Runtime | Node.js 20+ |
| WhatsApp | whatsapp-web.js (Puppeteer) |
| IA (primario) | Google Gemini (`gemini-2.5-flash`) + retries 3 con exponential backoff |
| IA (alternativo) | OpenAI (`gpt-4o-mini`) |
| Base de datos | PostgreSQL 16 (Prisma ORM con migrations formales desde Sprint hardening) |
| Scheduler | node-cron |
| Form filler público | Playwright (chromium headless 1228) + sesión persistida JSON |
| Deploy | Docker + Docker Compose |
| Observability | Sentry idle (activar con SENTRY_DSN) + Pino structured logs |

## Estados del flujo

| Estado | Significado | UI dedicada |
|---|---|---|
| `pendiente` | Aprobable por Varone | `/aprobacion?estado=pendiente` |
| `pendiente_revision` | Faltan dropdowns por completar (IA no decidió) | `/pendientes-revision` (badge amber) |
| `aprobado` | OK para publicar, en cola publisher | `/aprobacion?estado=aprobado` |
| `publicado` | Posteado al form público OK | `/aprobacion?estado=publicado` |
| `descartado` | No publicable | `/aprobacion?estado=descartado` |
| `fallo_publicacion` | Publisher agotó reintentos | `/errores-publicacion` (badge rojo) |

## Variables de entorno

```bash
# Base de datos
DATABASE_URL=postgresql://varone:varone_secret@localhost:5432/sistema_varone

# IA
AI_PROVIDER=gemini                    # 'gemini' | 'openai'
GEMINI_API_KEY=tu_api_key
OPENAI_API_KEY=                       # solo si AI_PROVIDER=openai

# WhatsApp
WA_GROUP_NAME=Piratería de Camiones   # grupo exacto a monitorear (con tildes)
VARONE_WA_NUMBER=5491144462389        # destino de alertas operacionales

# Framer publisher (microservicio Playwright)
FRAMER_PUBLISHER_URL=http://127.0.0.1:4001
FRAMER_PUBLISHER_TOKEN=               # token compartido

# Admin panel (Next.js :3001)
BACKEND_API_TOKEN=                    # token bypass server-to-server
ADMIN_PUBLIC_URL=http://localhost:3001

# Sprint hardening 13-mejoras (2026-06-27)
SENTRY_DSN=                           # opcional — observability prod
ADMIN_PASS_BCRYPT=                    # opcional — preferido vs ADMIN_PASS plaintext

# Sprint mapa + rate-limit (2026-06-27)
NOMINATIM_USER_AGENT=sistema-varone/1.0 (https://pirateriadecamiones.com.ar contacto@xxx)
GEOCODE_THROTTLE_MS=1100              # ms entre requests Nominatim (TOS >=1000)
GEOCODE_BATCH_SIZE=50                 # ubicaciones por corrida cron
RATE_LIMIT_MUTATIONS_PER_MIN=30       # caps rate limit (opcionales, defaults razonables)
RATE_LIMIT_PUBLISHER_PER_MIN=10
RATE_LIMIT_LOGIN_PER_15MIN=10
RATE_LIMIT_INYECCION_PER_MIN=60

# Alertas Telegram (opcional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

NODE_ENV=development
LOG_LEVEL=info
```

## Comandos

```bash
# Backend (:3000)
npm run dev              # tsx watch src/index.ts
npm run build            # tsc → dist/
npm start                # node dist/index.js

# Admin panel (:3001)
cd varone-admin && npm run dev    # next dev -p 3001
cd varone-admin && npm run build  # next build

# Framer publisher (:4001)
cd framer-publisher && npm run dev   # tsx watch src/server.ts

# Base de datos
npm run db:generate      # prisma generate
npm run db:push          # prisma db push (dev)
npx prisma migrate deploy  # producción (después del Sprint hardening 2026-06-27)
npm run db:studio        # Prisma Studio GUI

# Tests
npm run test             # vitest run (enum-matcher + ia)
npm run test:ia          # Test clasificación IA
npm run test:dedup       # Test deduplicación
npm run seed:demo        # Carga 8 reportes mock

# Docker
docker compose -f docker/docker-compose.yml -p sistema-varone up -d
```

## Tabla `reportes` (Prisma) — campos clave

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | Int (autoincrement) | PK |
| `hash` | String (unique) | SHA256 para dedup |
| `estado` | String | enum: pendiente / pendiente_revision / aprobado / publicado / descartado / fallo_publicacion |
| `camposFaltantes` | String[] | Lista de dropdowns que la IA no pudo decidir (vacía = OK) |
| `framerIntentos` | Int | Reintentos consumidos del publisher |
| `framerEnviado` | Bool | true si llegó a publicarse al form público |

**Campos Framer canonical** (los 10 que el form público requiere):
`provincia`, `tipoIncidenteFramer`, `fuerzaInterviniente`, `tipoVehiculo`, `cargaTransportada`, `modusOperandi`, `huboViolencia`, `tipoVehiculoInvolucrado`, `cantidadVehiculosInvolucrados`, `cantidadPersonasInvolucradas`.

## Endpoints clave (backend :3000)

| Método | Path | Descripción |
|---|---|---|
| GET | `/api/aprobacion/lista?estado=X` | Lista reportes por estado |
| GET | `/api/aprobacion/contar-pendientes-revision` | Count para badge amber |
| GET | `/api/aprobacion/contar-fallos-publicacion` | Count para badge rojo |
| POST | `/api/aprobacion/aprobar` | Mover a aprobado → dispara publisher |
| POST | `/api/aprobacion/editar` | Edita campos + recalcula camposFaltantes + auto-transición |
| POST | `/api/aprobacion/descartar` | Mover a descartado |
| POST | `/api/framer/reintentar` | Reintenta TODOS los pendientes Framer |
| POST | `/api/framer/reintentar-uno/:id` | Reintenta UN reporte en fallo_publicacion |
| GET | `/api/framer/health` | Proxy al health del publisher (browser + sesión) |
| POST | `/api/inyectar-mensaje` | Inyección manual de texto (cuando bot WA caído) |
| GET | `/api/reportes/geo?desde=&hasta=&tipo=&provincia=` | Reportes con coordenadas para mapa |
| GET | `/api/ubicaciones/stats` | Stats geocoding (total, resueltas, notFound, pendientes) |
| POST | `/api/ubicaciones/geocodear-batch` | Forzar batch manual Nominatim |

## Pendientes operativos

Después del Sprint hardening 13-mejoras (2026-06-27), quedan estos cleanups:

- [ ] Retire `publicarSitio()` + cron 9 AM/21:00 + endpoint POST `/api/framer/publicar` (todos no-op desde v2)
- [ ] Migración `prisma migrate deploy` en VPS (la baseline ya está marcada como applied en dev)
- [ ] Activar Sentry seteando `SENTRY_DSN` cuando se llegue a deploy
- [ ] Generar hash bcrypt y mover `ADMIN_PASS` → `ADMIN_PASS_BCRYPT`

## Inyección manual de mensajes

Cuando el bot WA no puede recibir mensajes:

```bash
curl -X POST http://127.0.0.1:3000/api/inyectar-mensaje \
  -H "Content-Type: application/json" \
  -H "X-Backend-Token: $BACKEND_API_TOKEN" \
  -d '{"texto":"Robaron camión en Ruta 3 km 50 hace 30 min https://..."}'
```
