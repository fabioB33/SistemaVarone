# Sistema Varone — Road Safety Monitor

## Qué es

Sistema de monitoreo automatizado de seguridad vial que detecta y trackea incidentes de "piratas del asfalto" (robos de carga, asaltos, bloqueos) en rutas argentinas. Opera 24/7 escuchando un grupo de WhatsApp y procesando los mensajes con IA para alimentar un panel de aprobación humana antes de publicar en Framer.

## Cómo funciona

```
WhatsApp Agent (tiempo real, grupo "Piratería de Camiones")
                   │
                   ▼
            Pipeline Service
            (cola FIFO, enriquece URL si tiene link)
                   │
                   ▼
         AI Service (Gemini / OpenAI fallback)
            ¿Es relevante?
           /              \
         NO               SÍ
       Descarta      Dedup Service (SHA256 + URL)
                     ¿Duplicado?
                    /           \
                  SÍ            NO
               Descarta    Registra en PostgreSQL (estado=pendiente)
                                │
                                ▼
                    Notificación a Varone vía WhatsApp
                    (links HMAC firmados Aprobar/Descartar)
                                │
                                ▼
                    Panel admin Next.js (:3001)
                    Varone aprueba → draft Framer
                    Cron 9 AM → publish sitio Framer
```

## Stack

| Capa | Tecnología |
|------|-----------|
| Lenguaje | TypeScript (strict mode) |
| Runtime | Node.js 20+ |
| WhatsApp | whatsapp-web.js (Puppeteer) |
| IA (primario) | Google Gemini (`gemini-2.5-flash`) |
| IA (alternativo) | OpenAI (`gpt-4o-mini`) |
| Base de datos | PostgreSQL 16 (Prisma ORM) |
| Scheduler | node-cron |
| Deploy | Docker + Docker Compose |
| Output | Framer Server API (vía microservicio framer-publisher) |

## Arquitectura

### Agents (entrada de datos)

- **WhatsApp Agent** (`src/agents/whatsapp.ts`): única fuente de entrada del sistema. Escucha el grupo configurado via `WA_GROUP_NAME`, extrae metadata del mensaje y lo envía al pipeline. Auto-reconexión con backoff exponencial, watchdog zombie de 6h, refresh automático de QR cada 50s. Si el mensaje contiene una URL, el pipeline hace fetch del HTML del artículo para enriquecer el contexto antes de pasarlo a la IA.

### Services (procesamiento)

- **Pipeline** (`src/services/pipeline.ts`): orquesta el flujo completo texto → IA → dedup → registro → webhook.
- **IA** (`src/services/ia.ts`): clasifica textos como relevantes/no-relevantes y estructura los incidentes en JSON. Soporta Gemini o OpenAI via `AI_PROVIDER`.
- **Dedup** (`src/services/dedup.ts`): normaliza texto, genera hash SHA256, verifica unicidad contra PostgreSQL.
- **Framer** (`src/services/framer.ts`): POST al endpoint de Framer con el reporte estructurado.

### Config

- **Prompts** (`src/config/prompts.ts`): system prompt especializado en seguridad vial.
- **Env** (`src/config/env.ts`): variables de entorno tipadas.

## Modelo de datos

**Tabla única: `reportes`** (Prisma)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | Int (autoincrement) | PK |
| hash | String (unique) | SHA256 para dedup |
| fuente | String | 'whatsapp' (única fuente actual) |
| fecha | String | YYYY-MM-DD |
| ubicacion | String | Localidad/ciudad |
| ruta | String | Nombre de ruta |
| tipoIncidente | String | robo_de_carga \| asalto \| bloqueo \| alerta \| tentativa |
| descripcion | String | Resumen 1-2 oraciones |
| textoOriginal | String | Texto crudo de entrada |
| urlNoticia | String? | URL del artículo si el mensaje WA contenía un link |
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

# Tests / utilidades
npm run test:ia          # Test clasificación IA
npm run test:dedup       # Test deduplicación
npm run seed:demo        # Carga 8 reportes mock para demo

# Docker
docker compose -f docker/docker-compose.yml up -d
```

## Variables de entorno

```bash
DATABASE_URL=postgresql://varone:varone_secret@localhost:5432/sistema_varone
AI_PROVIDER=gemini                    # 'gemini' | 'openai'
GEMINI_API_KEY=tu_api_key
OPENAI_API_KEY=                       # solo si AI_PROVIDER=openai
WA_GROUP_NAME=Piratería de Camiones   # grupo exacto a monitorear (con tildes)
FRAMER_PUBLISHER_URL=http://127.0.0.1:4001  # microservicio publisher
FRAMER_PUBLISHER_TOKEN=                 # token compartido con publisher
NODE_ENV=development
LOG_LEVEL=info
```

## Testing

El proyecto incluye datos simulados (`src/test/mensajes-simulados.ts`) con:
- 10 mensajes WhatsApp relevantes (robos, asaltos, bloqueos)
- 10 mensajes irrelevantes (personales, comercio)

Los tests (`npm run test:ia`, `npm run test:dedup`) validan clasificación IA y deduplicación.

`npm run seed:demo` carga 8 reportes en distintos estados (pendiente / aprobado / publicado / descartado) para poblar el panel durante demos.

## Inyección manual de mensajes

Endpoint de respaldo cuando el bot WA no puede recibir mensajes (por ejemplo si la lib whatsapp-web.js está desactualizada respecto al frontend de WA Web). Pasa el texto al pipeline como si hubiera entrado del grupo:

```bash
curl -X POST http://127.0.0.1:3000/api/inyectar-mensaje \
  -H "Content-Type: application/json" \
  -H "X-Backend-Token: $BACKEND_API_TOKEN" \
  -d '{"texto":"Robaron camión en Ruta 3 km 50 hace 30 min https://..."}'
```
