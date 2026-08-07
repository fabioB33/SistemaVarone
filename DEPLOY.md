# Deploy Sistema Varone en VPS

Sprint deploy-vps (2026-06-30) — Guía paso a paso para deployar el sistema completo en un VPS con HTTPS automático.

## ⚠️ PENDIENTE DE DEPLOY (2026-08-07) — no borrar hasta verificar en el VPS

Dos fixes commiteados y pusheados a `main` (`ace26c42`, `8959a8a4`) que **todavía no están en producción**. El bot del VPS sigue corriendo la versión vieja hasta que se haga el deploy de la sección ["Actualizar el sistema"](#actualizar-el-sistema) más abajo.

**Qué se arregló:**
1. **Ventana de recuperación de historial WA** (`ace26c42`) — al reconectar, antes solo recuperaba mensajes de las últimas 2hs fijas. Ahora calcula la ventana dinámicamente desde el último mensaje procesado (piso 2h / tope 24h). Reportado por el cliente: bot conectó a la mañana, a la noche pidió QR de nuevo, no trajo ninguna noticia del hueco perdido.
2. **Zombie auto-heal real** (`8959a8a4`) — el healthcheck (`verificarSaludWaSilencioso`, cron cada 5 min) detectaba el bot "conectado" pero colgado (Puppeteer `Runtime.callFunctionOn timed out`) y solo notificaba, prometiendo un reinicio que en la práctica podía tardar 6h o nunca llegar. Ahora `reiniciarClienteSeguro()` está exportada y el healthcheck la invoca directamente en cada tick mientras detecte zombie. Ver [[docs/vault/debt/DEBT-2026-08-05-varone-wa-zombie-protocoltimeout-healthcheck-no-reinicia]] en el vault de Pampa Labs.

**Cómo verificar tras el deploy** (correr contra los logs del backend en el VPS):

```bash
# Confirmar que el build corriendo tiene el fix (logea la ventana usada, no existía antes):
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs backend | grep "Historial procesado"
# Debe verse algo como: "Historial procesado: N mensajes analizados (ventana: X.Xhs, Y mensajes traídos del chat)."

# Confirmar que el auto-heal de zombie está activo (verification_query del DEBT):
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs --since 24h backend | grep -c "Zombie detectado"
docker compose -f docker/docker-compose.prod.yml -p sistema-varone logs --since 24h backend | grep -c "zombie-detectado"
# Ambos números deberían ser iguales (o el segundo apenas mayor, por reintentos) —
# cada zombie detectado debe tener un reinicio correlacionado.
```

**Acceptance criteria (marcar cuando se confirme en vivo, no solo en teoría):**
- [ ] El bot sobrevive una reconexión real sin perder noticias del hueco de desconexión.
- [ ] Un zombie detectado en producción dispara `reiniciarClienteSeguro('zombie-detectado')` sin intervención manual.
- [ ] El bot sobrevive 7 días conectado sin requerir reescaneo del cliente (criterio original del DEBT, sigue sin confirmar).

**Sigue sin resolver** (no arreglable sin acceso directo al VPS para investigar): por qué la sesión de WhatsApp a veces se pierde tras un reinicio forzado, pese a que el volumen `wwebjs_auth` persiste en disco. Si tras este deploy el auto-heal funciona pero el bot igual pide QR en cada reinicio, ese es el próximo punto a atacar.

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
