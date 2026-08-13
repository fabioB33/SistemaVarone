# Deploy Sistema Varone en VPS

Sprint deploy-vps (2026-06-30) — Guía paso a paso para deployar el sistema completo en un VPS con HTTPS automático.

## ✅ Deployado y verificado en VPS (2026-08-07, confirmado 2026-08-08)

Los fixes de ventana de recuperación de historial (`ace26c42`/`fe5a1630`), zombie auto-heal (`8959a8a4`/`69adf9cf`), `init:true` + limpieza de SingletonLock (`373ab50d`) y normalización de nombre de grupo (`887bfe7c`) están **deployados y verificados en el VPS** — confirmado contra el `dist/` corriendo, no solo el fuente (`Init=true`, `zombie-detectado` × 2 en `healthcheck.js`, `HISTORIAL_MAX_MS|ventana:` × 3 en `whatsapp.js`).

## ⚠️ PENDIENTE DE DEPLOY (2026-08-13) — no borrar hasta verificar en el VPS

4 cambios commiteados y pusheados a `main` (monorepo `92a89d5f` + `5217c558` + `34887e2a`, mismos cambios en el repo standalone `fabioB33/SistemaVarone` commits `e868fa6d` + `cced8381` + `29a90197`) que **todavía no están en producción**. El bot del VPS sigue corriendo la versión sin estos cambios hasta que se haga el deploy de la sección ["Actualizar el sistema"](#actualizar-el-sistema) más abajo.

### Fix 1 — vinculación de QR

**Reporte del cliente:** "no se puede vincular el QR" — el escaneo no completa la vinculación.

**Qué se arregló (2 causas independientes que se potencian entre sí):**
1. **Versión de WhatsApp Web pineada obsoleta.** `webVersionCache` estaba fijado a `2.3000.1034733596-alpha` desde 2026-05-07 (~3 meses). WhatsApp deprecia versiones viejas del frontend para el handshake de vínculos **nuevos** — sesiones ya vinculadas siguen andando, pero un QR escaneado contra un protocolo obsoleto puede ser rechazado silenciosamente. Actualizado a `2.3000.1044858477-alpha` (verificado accesible).
2. **El timer de refresh de QR (cada 50s) mataba escaneos en curso.** No distinguía "nadie escaneó" de "acaban de escanear, autenticando" — solo chequeaba `conectado`, que recién pasa a `true` en `ready` (puede tardar más de 50s en un VPS bajo carga). Fix: nuevo listener `authenticated` (dispara cuando el teléfono confirma el escaneo, ANTES de `ready`) con flag `autenticando` que el timer respeta, dándole un margen extra de 60s antes de forzar reinicio.

```bash
# Confirmar que el build corriendo tiene la versión de WA Web nueva:
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec backend \
  grep -o "2.3000.[0-9]*-alpha" dist/agents/whatsapp.js
# Debe verse: 2.3000.1044858477-alpha (o una versión más nueva si se re-pineó de nuevo)

# Confirmar que el listener de 'authenticated' está en el build corriendo:
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec backend \
  grep -c "authenticated" dist/agents/whatsapp.js
```

**Acceptance criteria:**
- [ ] El cliente escanea el QR y el bot pasa a "conectado" sin tener que reintentar.
- [ ] Si el escaneo tarda, el timer de 50s no interrumpe la autenticación en curso (verificar en logs: `"Escaneo en curso (authenticated sin ready aún)"` en vez de un reinicio a mitad de camino).

### Fix 2 — mensajes perdidos por timeout del pipeline ante rate-limit de la IA

**Encontrado en escaneo profundo, no reportado por el cliente todavía** (bug silencioso — no genera error visible, el mensaje simplemente nunca genera un reporte).

`PIPELINE_TIMEOUT_MS` estaba en 30s, menor que el peor caso del propio backoff de `analizarConIA()` ante rate-limit (8s + 32s = 40s solo de esperas). En una ráfaga de mensajes del grupo (el escenario más probable de pegarle un rate-limit real), el pipeline descartaba el mensaje como error antes de que el retry pudiera completar. Subido a 75s.

```bash
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec backend \
  grep -o "PIPELINE_TIMEOUT_MS = [0-9_]*" dist/services/pipeline.js
# Debe verse: PIPELINE_TIMEOUT_MS = 75_000 (o el valor equivalente compilado)
```

**Acceptance criteria:**
- [ ] Ningún mensaje se pierde en los logs con `Timeout (30000ms): analizarConIA` — si aparece `Timeout (75000ms)` en vez de eso, revisar si el rate-limit está durando aún más de lo esperado.

### Fix 3 — race condition en publicación a Framer

**Encontrado en escaneo profundo, no reportado por el cliente todavía.**

`postearReporte()` en `framer-publisher` se llamaba desde 3 puntos del backend (cron de reintentos, aprobar desde el panel, botón de reintentar uno) sin ningún lock compartido — dos publicaciones concurrentes podían pisarse la escritura del archivo de sesión de Framer, dejando cookies inválidas persistidas. Fix: cola de promesas interna en el publisher serializa todas las llamadas.

```bash
# Confirmar que el fix está en el build corriendo del publisher:
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec publisher \
  grep -c "colaPublicacion" dist/form-filler.js
```

**Acceptance criteria:**
- [ ] Si el cron de reintentos y una aprobación manual coinciden en el tiempo, ambas publicaciones se completan sin error de "sesión expirada" espurio.

### Feature 4 — toggle para apagar notificaciones de WhatsApp desde el panel

**Pedido explícito del cliente:** poder silenciar las notificaciones del sistema (desconexiones, zombie, backups, y también los reportes nuevos pendientes de aprobar) sin tocar el servidor.

Nuevo switch en `/configuracion` → "Notificaciones por WhatsApp". Aplica al toque. Guardado en `config_admin` con key `whatsapp.notificaciones_activas` (boolean, default `true` — sin tocar el switch el comportamiento es idéntico al de siempre). No requiere migración de schema (`ConfigAdmin.value` ya es `Json`).

```bash
# Confirmar que el fix está en el build corriendo del backend:
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec backend \
  grep -c "obtenerNotificacionesActivas" dist/services/notificaciones.js
# Debe verse >= 1

# Confirmar que el endpoint nuevo responde:
curl -s -X POST http://localhost:3000/api/admin/config/notificaciones \
  -H "Content-Type: application/json" -H "X-Backend-Token: $BACKEND_API_TOKEN" \
  -d '{"activas": true, "editorPor": "smoke-test"}'
# Debe devolver {"ok":true,"activas":true}
```

**Acceptance criteria:**
- [ ] El switch en `/configuracion` aparece y persiste el estado al recargar la página.
- [ ] Con el switch en OFF, `notificar()` no manda nada por WhatsApp (verificar en logs: `"notificaciones desactivadas desde /configuracion"`) pero el sistema sigue funcionando normal (reportes se siguen registrando, panel sigue mostrando todo).
- [ ] Con el switch en ON de nuevo, las notificaciones vuelven inmediatamente sin reiniciar nada.
- [ ] Los links de Aprobar/Descartar ya enviados por WhatsApp antes de apagar el switch siguen funcionando (no dependen de `notificar()`).

**Sigue sin resolver** (no arreglable sin acceso directo al VPS para investigar): por qué la sesión de WhatsApp a veces se pierde tras un reinicio forzado, pese a que el volumen `wwebjs_auth` persiste en disco.

---

## Requisitos del VPS

| Recurso | Mínimo | Recomendado |
|---|---|---|
| RAM | 2 GB | 4 GB |
| vCPUs | 2 | 2 |
| Disco SSD | 20 GB | 40 GB |
| OS | Ubuntu 22.04 / Debian 12 | Ubuntu 22.04 |

**Proveedores probados (baratos):** Contabo, Hetzner CX22, DigitalOcean droplet $6, Vultr.

## Pre-requisitos

1. **Dominio propio** apuntando al VPS. Ejemplo: `varone.tudominio.com` → IP del VPS (registro A).
2. **Credenciales:**
   - Gemini API key de aistudio.google.com
   - Cuenta Framer del sitio público (email + password)

## Deploy paso a paso

### 1. Setup del VPS (5 min)

```bash
# SSH al VPS como root
ssh root@IP-DEL-VPS

# Actualizar
apt update && apt upgrade -y

# Instalar Docker + docker compose
curl -fsSL https://get.docker.com | sh
apt install -y git

# Firewall básico
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

### 2. Clonar el repo (2 min)

```bash
cd /opt
git clone https://github.com/jorgeleporace/Pampa-Labs-Core.git
cd Pampa-Labs-Core/products/sistema-varone
```

### 3. Configurar env vars (10 min)

```bash
# Backend
cp .env.production.example .env
nano .env
chmod 600 .env
```

Editar `.env` con:
- `POSTGRES_PASSWORD`: `openssl rand -hex 32`
- `GEMINI_API_KEY`: pegar el key de aistudio.google.com
- `FRAMER_PUBLISHER_TOKEN`: `openssl rand -hex 32`
- `BACKEND_API_TOKEN`: `openssl rand -hex 32`
- `ADMIN_PASS`: password del panel (cambiar por uno fuerte)
- `ADMIN_SESSION_SECRET`: `openssl rand -hex 32`
- `ADMIN_DOMAIN`: el dominio real (ej. `varone.tudominio.com`)
- `LETSENCRYPT_EMAIL`: tu email

```bash
# Publisher (Playwright)
cp framer-publisher/.env.example framer-publisher/.env
nano framer-publisher/.env
```

Editar con:
- `FRAMER_SITE_EMAIL`: email de la cuenta Framer
- `FRAMER_SITE_PASSWORD`: password de la cuenta Framer
- `FRAMER_PUBLISHER_TOKEN`: mismo valor que en `.env` del backend

```bash
# Admin
cp varone-admin/.env.local.example varone-admin/.env
nano varone-admin/.env
```

Editar con:
- `NEXT_PUBLIC_SISTEMA_VARONE_URL=http://backend:3000`
- `BACKEND_API_TOKEN`: mismo del backend
- `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_SESSION_SECRET`: mismos del `.env`

### 4. Levantar todo (5-15 min primer boot)

```bash
docker compose -f docker/docker-compose.prod.yml -p sistema-varone up -d --build
```

Ver logs mientras arranca:
```bash
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs -f
```

Cuando termine (5-15 min según CPU del VPS), verás:
- `db-1`: healthy
- `backend-1`: `[Dashboard] Disponible en http://localhost:3000`
- `admin-1`: `▲ Next.js` ready
- `publisher-1`: `[framer-publisher v2] escuchando en http://127.0.0.1:4001`
- `nginx-proxy-1`: ready
- `acme-companion-1`: solicita certificado a Let's Encrypt (~30s)

### 5. Aplicar schema DB (2 min)

Primera vez, aplicar el schema Prisma:

```bash
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec backend npx prisma db push --skip-generate
```

### 6. Verificar que HTTPS funciona

Abrí en el browser: **`https://TU-DOMINIO.com`**

Deberías ver la página de login del panel Varone con certificado válido (candadito verde).

### 7. Configurar el bot WhatsApp (2 min)

1. Login al panel con `ADMIN_USER` / `ADMIN_PASS` del `.env`
2. Ir a `/aprobacion` o `/dashboard`
3. En el sidebar derecho verás **"Vinculá tu WhatsApp"** con un QR
4. Desde WhatsApp del celular Varone: `Ajustes → Dispositivos vinculados → Vincular dispositivo`
5. Escanear el QR
6. Verificar en el panel que dice **"Bot WhatsApp activo · Grupo Piratería de Camiones"**

### 8. Verificar el Framer publisher (5 min)

```bash
# Test manual del scraping
curl -X POST -H "X-Backend-Token: TU-TOKEN" \
  https://TU-DOMINIO.com/api/scrapers/correr/clarin
```

Debería retornar `{"ok":true, "notasScrapeadas": N, ...}`.

## Backup manual

```bash
# Dump completo de la DB
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec db \
  pg_dump -U varone sistema_varone > backup-$(date +%Y%m%d).sql
```

## Actualizar el sistema

```bash
cd /opt/Pampa-Labs-Core
git pull
cd products/sistema-varone
docker compose -f docker/docker-compose.prod.yml -p sistema-varone up -d --build
```

## Ver logs

```bash
# Todos los servicios
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs -f

# Solo backend
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs -f backend
```

## Troubleshooting

### El QR no aparece / bot desconectado

```bash
# Ver logs del backend
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs backend | tail -50

# Reiniciar solo el backend (mantiene la sesión)
docker compose -f docker/docker-compose.prod.yml -p sistema-varone restart backend
```

### Publisher falla al publicar

```bash
# Ver logs del publisher
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs publisher | tail -30

# Si la sesión Framer se pudrió, borrar y re-loguear:
docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec publisher rm -rf /app/data
docker compose -f docker/docker-compose.prod.yml -p sistema-varone restart publisher
```

### HTTPS no funciona

Let's Encrypt tiene rate limit — si intentaste muchas veces con dominio mal, esperá 1h.

```bash
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs acme-companion | tail -30
```

## Uso de recursos esperado

| Servicio | RAM | CPU |
|---|---|---|
| db (Postgres) | ~100 MB | ~1% |
| backend | ~250 MB | ~5% |
| admin (Next.js) | ~150 MB | ~2% |
| publisher (Playwright) | ~200 MB idle, ~500 MB durante scraping | 5-40% durante scraping |
| nginx-proxy | ~30 MB | ~1% |
| **Total idle** | **~700 MB** | **~5%** |
| **Total con scraping** | **~1 GB** | **~15%** |

Un VPS de 2 GB RAM + 2 vCPU maneja esto bien.
