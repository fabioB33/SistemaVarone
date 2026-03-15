# Sistema Varone — Road Safety Monitor

## Qué es

Sistema de monitoreo automatizado de seguridad vial que detecta y trackea incidentes de "piratas del asfalto" (robos de carga, asaltos, bloqueos) en rutas argentinas. Opera 24/7 con dos agentes concurrentes que alimentan un pipeline de IA.

## Cómo funciona

```
WhatsApp Agent (tiempo real)     Scraper Agent (cron cada 2hs)
        │                                │
        └──────────┬─────────────────────┘
                   │
            Pipeline Service
                   │
         AI Service (Gemini/OpenAI)
            ¿Es relevante?
           /              \
         NO               SÍ
       Descarta      Dedup Service (SHA256)
                     ¿Duplicado?
                    /           \
                  SÍ            NO
               Descarta    Registra en PostgreSQL
                                │
                          Framer Webhook
```

## Stack

| Capa | Tecnología |
|------|-----------|
| Lenguaje | TypeScript (strict mode) |
| Runtime | Node.js 20+ |
| WhatsApp | whatsapp-web.js (Puppeteer) |
| Web Scraping | Playwright (Chromium) |
| IA (primario) | Google Gemini (`gemini-1.5-flash`) |
| IA (alternativo) | OpenAI (`gpt-4o-mini`) |
| Base de datos | PostgreSQL 16 (Prisma ORM) |
| Scheduler | node-cron |
| Deploy | Docker + Docker Compose |
| Output | Framer webhook |

## Arquitectura

### Agents (entrada de datos)

- **WhatsApp Agent** (`src/agents/whatsapp.ts`): escucha un grupo específico de WhatsApp (configurable via `WA_GROUP_NAME`), extrae metadata del mensaje y lo envía al pipeline. Auto-reconexión con retry de 10s.
- **Scraper Agent** (`src/agents/scraper.ts`): scraping con Playwright de 5 portales argentinos (La Nación, Crónica, Infobae, TN, Clarín — secciones policiales/seguridad). Cron configurable, default cada 120 min.

### Services (procesamiento)

- **Pipeline** (`src/services/pipeline.ts`): orquesta el flujo completo texto → IA → dedup → registro → webhook.
- **IA** (`src/services/ia.ts`): clasifica textos como relevantes/no-relevantes y estructura los incidentes en JSON. Soporta Gemini o OpenAI via `AI_PROVIDER`.
- **Dedup** (`src/services/dedup.ts`): normaliza texto, genera hash SHA256, verifica unicidad contra PostgreSQL.
- **Framer** (`src/services/framer.ts`): POST al endpoint de Framer con el reporte estructurado.

### Config

- **Portales** (`src/config/portales.ts`): selectores CSS por portal para scraping.
- **Prompts** (`src/config/prompts.ts`): system prompt especializado en seguridad vial.
- **Env** (`src/config/env.ts`): variables de entorno tipadas.

## Modelo de datos

**Tabla única: `reportes`** (Prisma)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | Int (autoincrement) | PK |
| hash | String (unique) | SHA256 para dedup |
| fuente | String | 'whatsapp' \| 'scraping' |
| fecha | String | YYYY-MM-DD |
| ubicacion | String | Localidad/ciudad |
| ruta | String | Nombre de ruta |
| tipoIncidente | String | robo_de_carga \| asalto \| bloqueo \| alerta \| tentativa |
| descripcion | String | Resumen 1-2 oraciones |
| textoOriginal | String | Texto crudo de entrada |
| urlNoticia | String? | URL (solo scraping) |
| creadoEn | DateTime | Timestamp auto |

## Comandos

```bash
# Desarrollo
npm run dev              # tsx watch src/index.ts

# Build y producción
npm run build            # tsc → dist/
npm start                # node dist/index.js

# Base de datos
npm run db:generate      # prisma generate
npm run db:push          # prisma db push
npm run db:studio        # Prisma Studio GUI

# Tests
npm run test:ia          # Test clasificación IA
npm run test:dedup       # Test deduplicación
npm run test:scraper     # Test scraping de portales

# Docker
docker compose -f docker/docker-compose.yml up -d
```

## Variables de entorno

```bash
DATABASE_URL=postgresql://varone:varone_secret@localhost:5432/sistema_varone
AI_PROVIDER=gemini                    # 'gemini' | 'openai'
GEMINI_API_KEY=tu_api_key
OPENAI_API_KEY=                       # solo si AI_PROVIDER=openai
WA_GROUP_NAME=Nombre del Grupo        # grupo exacto a monitorear
FRAMER_ENDPOINT=https://...           # webhook de salida
SCRAPING_INTERVAL_MINUTES=120         # frecuencia scraping
NODE_ENV=development
LOG_LEVEL=info
```

## Portales monitoreados

1. La Nación — Seguridad
2. Crónica — Policiales
3. Infobae — Policiales
4. TN — Policiales
5. Clarín — Policiales

## Testing

El proyecto incluye datos simulados (`src/test/mensajes-simulados.ts`) con:
- 10 mensajes WhatsApp relevantes (robos, asaltos, bloqueos)
- 10 mensajes irrelevantes (personales, comercio)
- 4 noticias relevantes + 4 irrelevantes

Los tests validan clasificación IA, deduplicación y extracción de selectores CSS.
