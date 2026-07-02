# 🎯 HANDOFF — Instrucciones para el próximo dev (y su Claude Code)

**Sistema Varone — Monitor de piratería del asfalto en rutas argentinas**

> Este documento es la **puerta de entrada** al proyecto para cualquier
> persona que se sume a mantener/deployar este sistema. Está escrito para
> que **Claude Code lea este archivo primero** antes de tocar cualquier
> cosa. Después de leerlo, seguí con:
>
> 1. `products/sistema-varone/CLAUDE.md` — contexto técnico del producto
> 2. `products/sistema-varone/DEPLOY.md` — deploy paso a paso al VPS
> 3. `products/sistema-varone/OPERATIONS.md` — troubleshooting en runtime

---

## 📋 TL;DR — Lo que hay que hacer en orden

**Objetivo:** deployar el sistema a un VPS para que Varone lo pruebe.

**Pasos (~2-3h total):**

1. ✅ **Leer este archivo completo** (5 min)
2. ⏳ **Crear cuentas de servicios externos con emails del cliente** (30 min)
   - Supabase (base de datos gestionada)
   - Google AI Studio (para Gemini)
   - VPS (Contabo/Hetzner/DigitalOcean)
   - Dominio propio
3. ⏳ **Migrar DB de Postgres local → Supabase** (30 min)
4. ⏳ **Configurar `.env` de producción** con secrets nuevos (15 min)
5. ⏳ **Deploy al VPS con docker compose** (30 min primer boot)
6. ⏳ **Escanear QR de WhatsApp desde el celular de Varone** (2 min)
7. ⏳ **Smoke E2E** con Varone al lado (15 min)

---

## 🧠 Contexto crítico (Claude leé esto ANTES de tocar nada)

### Qué hace el sistema

Bot autónomo que:

1. **Escucha un grupo de WhatsApp** en tiempo real (`whatsapp-web.js`)
2. **Scrapea 6 portales policiales** cada 15h (Clarín, Crónica, Diario Popular, Infobae, La Nación, Página 12)
3. **Pre-filtra** por whitelist/blacklist de keywords (ahorra tokens de IA)
4. **Clasifica con Gemini** (con retries y fallback a OpenAI)
5. **Deduplica** por hash SHA256
6. **Alimenta un panel** donde Varone aprueba/descarta cada noticia
7. **Publica automáticamente** al formulario público de `pirateriadecamiones.com.ar` via **Playwright** (llenando el form del sitio)

### Arquitectura — 3 servicios + DB

```
┌───────────────────────────────────────────────────────────────┐
│  :3000  Backend Express (sistema-varone/)                     │
│         - WhatsApp agent + Gemini + crons                     │
│         - API REST (/api/aprobacion/*, /api/admin/*)          │
│         - Prisma → PostgreSQL                                 │
│         - NO expone UI, solo endpoints JSON                   │
└───────────────────────────────────────────────────────────────┘
                          ↑
                  llama con X-Backend-Token
                          │
┌───────────────────────────────────────────────────────────────┐
│  :3001  Admin Panel Next.js (varone-admin/)                   │
│         - UI web para Varone                                  │
│         - Login: varone / [pass del .env]                     │
│         - Páginas: /dashboard /aprobacion /mapa /descartados  │
│                    /configuracion (panel admin nuevo)         │
│         - Server Components + Server Actions                  │
│         - ESTO es lo que Varone abre en el browser            │
└───────────────────────────────────────────────────────────────┘
                          ↑
                          │
┌───────────────────────────────────────────────────────────────┐
│  :4001  Framer Publisher (framer-publisher/)                  │
│         - Microservicio Playwright                            │
│         - Login + form-fill en pirateriadecamiones.com.ar     │
│         - Backend :3000 lo invoca al aprobar noticias         │
└───────────────────────────────────────────────────────────────┘
                          ↓
                   PostgreSQL 16
                (local en dev / Supabase en prod)
```

### Reglas absolutas — NO romper (heredadas del CLAUDE.md raíz)

1. **NO hardcodear secrets, group IDs, URLs de prod, tokens**. Todo via env vars.
2. **Antes de tocar código de producción**, `git status` + verificar en qué branch estás.
3. **NUNCA commitear** el `.env` real. Solo `.env.production.example`.
4. **NO cambiar la firma de `procesarTexto()`** en `src/services/pipeline.ts` sin verificar los ~5 callers.
5. **NO tocar el enum `TIPOS_VEHICULO` / `CARGAS_TRANSPORTADAS` etc.** en `src/config/enums-framer.ts` sin sincronizar con el form real de pirateriadecamiones.com.ar. Si los valores no matchean exacto → publisher falla.
6. **NO deshabilitar el pre-filtro** — es lo que evita que la IA queme quota con noticias no del nicho.

---

## 🔐 PASO 1 — Crear cuentas de servicios externos

**Todas las cuentas van con email de VARONE**, no del dev, así el cliente es dueño de todo.

### 1.1. Supabase (base de datos)

Va a reemplazar el PostgreSQL local con una DB gestionada en la nube. Ventajas: backups automáticos, sin manejar Postgres en el VPS, RLS opcional, panel web para inspeccionar tablas.

**Pasos:**

1. Ir a https://supabase.com/dashboard/sign-up
2. Registrarse con **email de Varone** (o el que él designe)
3. Crear **New Project**:
   - **Name**: `sistema-varone-prod`
   - **Database Password**: generar con `openssl rand -hex 32` y guardar en 1Password/Bitwarden
   - **Region**: `sa-east-1` (São Paulo) — más cercano a Argentina
   - **Pricing Plan**: **Free** alcanza para empezar (500 MB, 2 GB egress). Cuando Varone use mucho, migrar a Pro ($25/mes).
4. Esperar 2 min a que provisione
5. Ir a **Project Settings → Database → Connection string** y anotar:
   - `URI` — algo como: `postgresql://postgres.abcdefg:PASSWORD@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
   - **IMPORTANTE**: usar la modalidad **Session** o **Transaction** según lo que dice Prisma docs. Para nuestro caso funciona **Transaction Pooler** (puerto 6543) porque Prisma no usa prepared statements por default.

### 1.2. Google AI Studio (Gemini API key) ⚠ OBLIGATORIO

**Sin esta key el sistema NO funciona.** La IA que clasifica cada mensaje
del grupo de WhatsApp y cada nota scrapeada es Google Gemini. El sistema
también soporta OpenAI como fallback pero es opcional.

**Cómo generar la key:**

1. Ir a https://aistudio.google.com/apikey
2. **Iniciar sesión con la cuenta Google de Varone** (o la que él designe
   para el proyecto — importante que sea del cliente, no del dev, así el
   billing y los limits quedan a su nombre)
3. Click **Create API Key** → **Create API key in new project** (o elegir
   un proyecto existente si ya hay)
4. Google Cloud crea el proyecto automáticamente
5. Copiar el API key que aparece — formato:
   - Formato viejo: `AIzaSy...` (39 chars)
   - Formato nuevo: `AQ.Ab8...` (44+ chars)
   - Ambos funcionan
6. **Guardar el key en 1Password/Bitwarden inmediatamente.** Google lo
   muestra una sola vez. Si lo perdés, hay que crear otro (los viejos
   siguen funcionando pero no se pueden ver más).

**Cómo verificar que la key funciona ANTES de deployar:**

```bash
# Test manual con curl (reemplazar TU_KEY)
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=TU_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"Decí solo: ok"}]}]}'
```

Respuesta esperada:
```json
{
  "candidates": [{
    "content": { "parts": [{ "text": "ok" }], "role": "model" },
    "finishReason": "STOP"
  }],
  "usageMetadata": { "promptTokenCount": 5, ... }
}
```

Si retorna un `401` o `400` con `API_KEY_INVALID`, la key está mal
copiada o no fue activada aún.

**Límites del Free tier de Gemini (verificar en https://ai.google.dev/pricing):**

| Métrica | Free tier |
|---|---|
| Requests / min | 15 |
| Tokens input / min | 1M |
| Requests / día | 1500 |

Con el pre-filtro que tenemos, el sistema procesa **~50-100 mensajes/día
que llegan a la IA** (el resto los descarta el pre-filtro antes). Estamos
holgadamente adentro del free tier.

**Si el sistema empieza a fallar con `429 Too Many Requests`:**

El código ya tiene retries con exponential backoff (`src/services/ia.ts`).
Si Gemini está saturado, espera 8-32 segundos entre intentos y sigue.
No es urgente. Si pasa muy seguido:
- Upgrade a Pay-as-you-go (~$0.075 / 1M tokens input, muy barato)
- O configurar `OPENAI_API_KEY` en el `.env` para que use OpenAI como fallback

**Dónde va la key en el sistema:**

En `.env` del backend:
```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=AQ.Ab8RN6L...   # ← acá va la key que copiaste
OPENAI_API_KEY=                 # opcional, dejá vacío
```

**Cuidado con el commit:** el `.env` está en `.gitignore` pero verificá
con `git status` antes de cada commit que no aparezca. Si por error el
key llegó al repo, revocalo desde https://aistudio.google.com/apikey y
generá otro.

### 1.3. VPS

**Opciones probadas por precio/calidad (todas alcanzan):**

| Proveedor | Plan | Precio/mes | Notas |
|---|---|---|---|
| **Contabo** | VPS S SSD (4 GB RAM / 2 vCPU) | ~$5 | Mejor precio/GB, buen soporte |
| **Hetzner** | CX22 (4 GB / 2 vCPU / 40 GB) | ~$5 | El mejor tech pero requiere KYC |
| **DigitalOcean** | Droplet Regular ($6) (1 GB / 1 vCPU / 25 GB) | $6 | Un poco justo, mejor el de $12 |
| **Vultr** | Cloud Compute ($6) | $6 | Buen middle ground |

**Recomendación:** Contabo VPS S SSD.

**Pasos:**

1. Registrarse con email de Varone
2. Ordenar VPS **Ubuntu 22.04** (imagen limpia)
3. Anotar IPv4 pública, root password (o mejor: subir SSH key durante el signup)

### 1.4. Dominio

Varone probablemente ya tiene uno. Si no, comprar en https://www.nic.ar (dominios .ar) o https://cloudflare.com/products/registrar/ (más barato para .com).

**Configuración DNS:**

Crear **registro A** apuntando al VPS:

```
Tipo   Nombre        Valor              TTL
A      varone        IP.DEL.VPS         3600
A      *.varone      IP.DEL.VPS         3600  (opcional, para subdominios futuros)
```

Ejemplo: si el dominio es `pirateriadecamiones.com.ar`, el panel queda en `https://varone.pirateriadecamiones.com.ar`.

---

## 🗄 PASO 2 — Migrar Postgres local → Supabase

El sistema hoy tiene una DB Postgres local con datos de prueba. Para el VPS necesitamos que use Supabase.

### Opción A: DB fresca en Supabase (recomendado para deploy inicial)

Si Varone no necesita los reportes de prueba, arrancamos con DB vacía:

```bash
# En tu compu, con la DB local corriendo:
cd products/sistema-varone

# 1. Setear temporalmente la URL de Supabase en .env
# DATABASE_URL="postgresql://postgres.abc:PASS@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

# 2. Aplicar el schema a Supabase
npx prisma db push --skip-generate

# 3. Verificar que se crearon las tablas en Supabase:
#    https://supabase.com/dashboard → tu proyecto → Table Editor
#    Deberías ver: reportes, alertas, audit_log, wa_state, scrapes_descartados,
#                  config_admin, ubicaciones_geocoded, resumenes_diarios

# 4. Restaurar el .env con la URL local para seguir desarrollando local
```

### Opción B: Copiar datos existentes (si querés preservar reportes)

```bash
# 1. Dump completo de la DB local
docker exec sistema-varone-db-1 pg_dump -U varone -d sistema_varone \
  --no-owner --no-acl --clean --if-exists > dump-local.sql

# 2. Import a Supabase usando la connection string DIRECTA (no la pooler):
#    Copiar de Supabase Dashboard → Settings → Database → "Connection string" → "URI"
#    Usar el que dice "Direct connection" (puerto 5432), no el pooler

psql "postgresql://postgres:PASS@db.abc.supabase.co:5432/postgres" < dump-local.sql

# 3. Verificar que los datos están:
psql "postgresql://postgres:PASS@db.abc.supabase.co:5432/postgres" \
  -c "SELECT COUNT(*), estado FROM reportes GROUP BY estado;"
```

**⚠ IMPORTANTE:**

- Para **runtime del backend en el VPS**, usar el **Pooler (puerto 6543)** — soporta más conexiones simultáneas.
- Para **migrations / db push / seed / scripts admin**, usar el **Direct (puerto 5432)** — el pooler no soporta transacciones DDL largas.

---

## 🔧 PASO 3 — Preparar `.env` de producción

En tu máquina, crear localmente estos 3 archivos con los valores reales:

### 3.1. `.env` del backend

```bash
cd products/sistema-varone
cp .env.production.example .env
nano .env
```

Editar:

```bash
# ─── Supabase (usar el POOLER, puerto 6543) ────────────────
DATABASE_URL="postgresql://postgres.ABC:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Los `POSTGRES_*` los ignoramos cuando usamos Supabase, pero dejarlos vacíos rompe docker-compose local. Poner valores dummy:
POSTGRES_USER=unused
POSTGRES_PASSWORD=unused
POSTGRES_DB=unused

# ─── IA ────────────────────────────────────────────────────
AI_PROVIDER=gemini
GEMINI_API_KEY=AQ.Ab8RN6...  # la que sacaste en el paso 1.2

# ─── WhatsApp ──────────────────────────────────────────────
WA_GROUP_NAME=Piratería de Camiones
VARONE_WA_NUMBER=5491144462389  # cambiar por el celu real de Varone

# ─── Framer publisher ──────────────────────────────────────
FRAMER_PUBLISHER_URL=http://publisher:4001
FRAMER_PUBLISHER_TOKEN=$(openssl rand -hex 32)  # ejecutar y pegar el resultado

# ─── Admin panel auth ──────────────────────────────────────
BACKEND_API_TOKEN=$(openssl rand -hex 32)
ADMIN_USER=varone
ADMIN_PASS=CAMBIAR-POR-PASSWORD-FUERTE  # coordinar con Varone
ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_PUBLIC_URL=https://varone.tudominio.com

# ─── Nginx + Let's Encrypt ─────────────────────────────────
ADMIN_DOMAIN=varone.tudominio.com  # EXACTO — el DNS ya tiene que apuntar acá
LETSENCRYPT_EMAIL=contacto@tudominio.com

# ─── Nominatim (mapa) ─────────────────────────────────────
NOMINATIM_USER_AGENT=sistema-varone/1.0 (https://varone.tudominio.com contacto@tudominio.com)

# ─── Sistema ──────────────────────────────────────────────
NODE_ENV=production
LOG_LEVEL=info
```

### 3.2. `.env` del admin panel

```bash
cd varone-admin
cp .env.example .env
nano .env
```

```bash
NEXT_PUBLIC_SISTEMA_VARONE_URL=http://backend:3000
BACKEND_API_TOKEN=EL-MISMO-QUE-EN-EL-BACKEND
ADMIN_USER=varone
ADMIN_PASS=EL-MISMO-QUE-EN-EL-BACKEND
ADMIN_SESSION_SECRET=EL-MISMO-QUE-EN-EL-BACKEND
```

### 3.3. `.env` del framer-publisher

```bash
cd ../framer-publisher
cp .env.example .env
nano .env
```

```bash
FRAMER_SITE_EMAIL=cuenta-framer-varone@ejemplo.com  # cuenta del sitio Framer
FRAMER_SITE_PASSWORD=password-de-esa-cuenta
FRAMER_STORAGE_STATE_PATH=./data/framer-session.json
FRAMER_HEADLESS=true
FRAMER_NAV_TIMEOUT_MS=60000
PORT=4001
FRAMER_PUBLISHER_TOKEN=EL-MISMO-QUE-EN-EL-BACKEND
```

### 3.4. Seguridad de los `.env`

```bash
chmod 600 products/sistema-varone/.env
chmod 600 products/sistema-varone/varone-admin/.env
chmod 600 products/sistema-varone/framer-publisher/.env
```

**NUNCA commitear estos archivos.** El `.gitignore` ya los ignora, pero verificá con `git status` antes de cada commit.

---

## 🚀 PASO 4 — Deploy al VPS

Este paso está detallado paso a paso en **[DEPLOY.md](./DEPLOY.md)**. Resumen:

```bash
# 1. SSH al VPS
ssh root@IP.DEL.VPS

# 2. Setup inicial (Docker + firewall)
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y git ufw
ufw allow OpenSSH 80/tcp 443/tcp
ufw --force enable

# 3. Clonar el repo
cd /opt
git clone https://github.com/jorgeleporace/Pampa-Labs-Core.git
cd Pampa-Labs-Core/products/sistema-varone

# 4. Copiar los 3 .env desde tu máquina (via scp)
# En tu máquina local, otra terminal:
scp products/sistema-varone/.env root@IP:/opt/Pampa-Labs-Core/products/sistema-varone/
scp products/sistema-varone/varone-admin/.env root@IP:/opt/Pampa-Labs-Core/products/sistema-varone/varone-admin/
scp products/sistema-varone/framer-publisher/.env root@IP:/opt/Pampa-Labs-Core/products/sistema-varone/framer-publisher/

# 5. Volver al VPS y verificar permisos
ssh root@IP.DEL.VPS
cd /opt/Pampa-Labs-Core/products/sistema-varone
chmod 600 .env varone-admin/.env framer-publisher/.env

# 6. Modificar docker-compose.prod.yml — QUITAR el servicio `db`
#    porque ahora usamos Supabase. Editar y comentar/borrar:
#    - services.db (todo el bloque)
#    - depends_on: db (en backend)
#    - volumes: pgdata (abajo del todo)
nano docker/docker-compose.prod.yml

# 7. Arrancar todos los servicios
docker compose -f docker/docker-compose.prod.yml -p sistema-varone up -d --build

# 8. Ver logs primer boot (5-15 min)
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs -f
```

**Verificación de que arrancó bien:**

```bash
docker compose -f docker/docker-compose.prod.yml -p sistema-varone ps
```

Deberías ver:
- `backend-1` → running healthy
- `admin-1` → running healthy
- `publisher-1` → running healthy
- `nginx-proxy-1` → running
- `acme-companion-1` → running

---

## 📱 PASO 5 — Escanear QR de WhatsApp

Varone tiene que hacer esto **desde su celular**:

1. Abrir `https://varone.tudominio.com` en el browser
2. Login con `varone` + el `ADMIN_PASS` que le pasaste
3. Ir a **`/dashboard`** → verás un QR grande en el widget "Vinculá tu WhatsApp"
4. En su celular: **WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo**
5. Escanear el QR
6. El widget cambia a "Bot WhatsApp activo · Grupo Piratería de Camiones"

**⚠ Si el QR expira**, el bot regenera uno nuevo cada ~60s. Refrescá la página.

---

## 🧪 PASO 6 — Smoke test con Varone

Con Varone al lado, probar:

### 6.1. Recibir un mensaje del grupo
- Que un miembro del grupo mande un mensaje real de piratería
- En ~15s aparece el reporte en `/aprobacion?estado=pendiente` con badge verde "WhatsApp"
- Varone verifica que la extracción de la IA es correcta

### 6.2. Aprobar y publicar
- Click "Aprobar y publicar"
- 15-30s después, el reporte pasa a `/aprobacion?estado=publicado`
- Verificar que la noticia apareció en `pirateriadecamiones.com.ar/formulario-de-incidentes` (el listado público)

### 6.3. Scrapear un portal
- Ir a `/dashboard` → click "Scrapear ahora"
- Debería scrapear los 6 portales en paralelo (o los que estén activados en `/configuracion`)
- Aparecen reportes con badge naranja "📰 Clarín" / "📰 Infobae" etc.

### 6.4. Panel de configuración
- Ir a `/configuracion`
- Desactivar un portal (ej. Página 12) + Guardar
- Verificar que el toast dice "Portales guardados"
- El próximo cron ya no scrapeará ese portal

### 6.5. Cambio del grupo WhatsApp
- En `/configuracion`, cambiar el nombre del grupo (test)
- Guardar → aparece aviso "Reiniciá el bot"
- Reiniciar el backend en el VPS: `docker compose restart backend`
- Escanear el QR nuevo (porque cambió el grupo target)

---

## 📚 Documentos relacionados

| Archivo | Cuándo leerlo |
|---|---|
| **CLAUDE.md** | Contexto técnico del producto (arquitectura, decisiones, historial) |
| **DEPLOY.md** | Deploy paso a paso al VPS (más detallado que este) |
| **OPERATIONS.md** | Runbook de operaciones diarias (backup, logs, restart, troubleshooting) |
| **.env.production.example** | Template de variables de entorno |
| **prisma/schema.prisma** | Schema de la DB (todas las tablas y relaciones) |

---

## 🆘 Troubleshooting típico

### "El bot no se conecta al grupo aunque escaneé el QR"

- Verificar que el nombre del grupo en `.env` (`WA_GROUP_NAME`) es **EXACTO** (mayúsculas, tildes, espacios)
- Si Varone cambió el nombre del grupo, editar en `/configuracion` → guardar → reiniciar backend
- El nombre canónico es `Piratería de Camiones` (con tildes)

### "Los portales scrapean 0 notas"

- Los portales cambian su HTML periódicamente. Si un scraper deja de traer notas:
  1. Ir a `/dashboard` → sección "Estado de scrapers"
  2. El healthcheck diario 10 AM ART alerta si un portal está en cero
  3. Ver el HTML actual del portal en el browser
  4. Actualizar los selectores en `src/agents/portales/[portal].ts`
  5. Deploy nuevo build

### "El publisher falla con 'No pude seleccionar X en dropdown Y'"

- El sitio público de Framer cambió una opción del dropdown
- Verificar los enums en `src/config/enums-framer.ts` vs el sitio real
- Cuando la IA guarda un valor no-canonical, el reporte queda en `fallo_publicacion`
- Varone puede editar el campo culpable en `/aprobacion?estado=fallo_publicacion` y click "Corregir y reintentar"

### "El certificado HTTPS no se genera"

- Let's Encrypt tiene rate limit: máximo 5 fallos por dominio por hora
- Verificar que el DNS ya propagó: `dig varone.tudominio.com`
- Ver logs: `docker compose logs acme-companion | tail -30`

### "El VPS se quedó sin RAM"

- Con 2 GB RAM justo alcanza si el publisher no está scrapeando activamente
- Chrome de Playwright puede llegar a 500 MB durante el submit
- Solución: upgrade a 4 GB RAM ($3 más al mes en Contabo)

---

## 🎯 Mensaje al Claude Code del próximo dev

Si sos Claude Code leyendo este archivo por primera vez, tené presente:

1. **Este proyecto tiene reglas universales heredadas del monorepo Pampa Labs.** Leer `Pampa-Labs-Core/CLAUDE.md` (el del root) tiene las 11 reglas absolutas.

2. **Regla crítica #9 NO-HARDCODED:** todo lo que se puede cambiar por el operador (nombre de grupo, portales activos, tokens, dominios) tiene que ir en env vars o en la tabla `config_admin`. **Nada hardcoded en código.**

3. **Regla crítica #7 EMPIRICAL-FIRST:** antes de decir "esto no funciona", verificá empíricamente:
   - Leer logs actuales del backend: `docker compose logs backend --tail 100`
   - Query directo a la DB para ver estado real
   - Test manual con curl al endpoint

4. **NO modificar el schema Prisma** sin correr `prisma db push` **antes** de cualquier deploy. Los reportes en Supabase se pueden perder si hacés un cambio destructivo.

5. **NO borrar la tabla `config_admin`** — contiene los overrides que Varone puso desde el panel.

6. **Los tests son sagrados.** Antes de cualquier commit:
   ```bash
   cd products/sistema-varone
   npx tsc --noEmit
   npm run test
   cd varone-admin && npx tsc --noEmit && npm run build
   ```

7. **Cuando el usuario pida algo, verificar en qué estado está el proyecto:**
   ```bash
   git log --oneline -5
   git status
   ```
   Si hay commits recientes que no viste, leerlos primero.

8. **Documentar todo cambio en el commit message.** El monorepo tiene una regla explícita de que cada cambio se documenta con contexto (qué, por qué, quality gates, trade-offs).

---

_Última actualización: 2026-06-30 (Sprint deploy-vps + admin-config)_
