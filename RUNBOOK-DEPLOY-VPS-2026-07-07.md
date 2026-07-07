---
title: "Runbook Deploy VPS — Sistema Varone: análisis manual URL + perf fix connection_limit + cache TTL (2026-07-07)"
date: 2026-07-07
last_updated: 2026-07-07
tags: [runbook, deploy, vps, sistema-varone, perf, supabase, pooler, connection-limit, docker-compose]
status: pending-execution
owner: quien-deploye
priority: high
type: runbook
producto: sistema-varone
budget_estimado: "~15 minutos"
related:
  - HANDOFF-NUEVO-DEV.md (mismo repo, sección troubleshooting perf al final)
  - "Context empírico completo vive en el monorepo Pampa Labs (docs/vault/sessions/2026-07-07-LOG-sistema-varone-analisis-url-manual-y-perf-fix-connection-limit.md) — no accesible desde este repo standalone."
---

# Runbook Deploy VPS — Sistema Varone (perf fix + análisis manual URL)

> [!info] Contexto
> El 2026-07-07 se cerraron 2 sprints en sistema-varone: **feature nueva** (endpoint + UI para analizar manualmente una URL de nota) + **perf fix crítico** (dashboard bajó de ~10s a ~2ms).
>
> **El paso más crítico de este deploy es actualizar `DATABASE_URL` en el `.env` del VPS.** Si no lo hacés, el cache ayuda pero los cache-miss siguen tardando 10s y el error `/api/scrapers/status` HTTP 500 no se corrige.
>
> Este runbook es paso-a-paso — copiá los comandos tal cual.

---

## Pre-flight

Necesitás:
- [ ] Acceso SSH al VPS Hostinger de Pampa Labs (IP `82.29.61.151`, usuario `root`).
- [ ] Password de Supabase para la DB de Varone: `VictorVarone2026`.
- [ ] Repo del sistema Varone clonado en el VPS. La ruta que se usó en el deploy original es `/opt/sistema-varone/` (verificar con `ls -la /opt/`).
- [ ] Docker + docker compose corriendo (ya deberían estar del deploy anterior).
- [ ] ~15 minutos y saber que Varone no está usando el panel activamente (los servicios se reinician).

Si algo de eso falta o dudás, PARÁ y avisá a Jorge o a Fabio antes de tocar.

---

## Paso 0 — Backup de seguridad (2 min)

Antes de cualquier cambio, backup del `.env` actual y snapshot del estado docker.

```bash
ssh root@82.29.61.151
```

Una vez adentro:

```bash
cd /opt/sistema-varone   # o donde esté el repo — ajustar si es distinto
ls -la .env              # confirmar que existe
cp .env .env.backup-perf-fix-2026-07-07
docker compose ps        # anotá qué está UP para verificar al final
git log --oneline -3     # anotá el commit actual para rollback si hace falta
```

Deberías ver commits anteriores al que vas a deployar. Anotá el SHA del HEAD actual (te sirve para rollback).

---

## Paso 1 — Traer los cambios del repo (1 min)

Los commits nuevos son:
- `1d2a69f5` — `feat: análisis manual de URL + cron portales a 3h`
- `dfce3c07` — `perf: connection_limit=10 + cache TTL — dashboard 10s→2ms`

Ambos ya están en `main` del standalone repo `fabioB33/SistemaVarone` (que es el que usa el VPS). Traer:

```bash
git pull origin main
git log --oneline -3
```

Verificá que el HEAD sea `dfce3c07 perf: connection_limit=10 + cache TTL — dashboard 10s→2ms`.

Si el pull falla por conflictos o remote diferente, PARÁ y avisá — no forzar merge.

---

## Paso 2 — 🔥 Cambio crítico: `DATABASE_URL` en `.env` (2 min)

**Este es el paso más importante. Sin esto, el fix de perf no funciona.**

Abrí el `.env`:

```bash
nano .env      # o vim si preferís
```

Buscá la línea `DATABASE_URL=...`. Debería tener algo así (con la password real):

```
DATABASE_URL="postgresql://postgres.rfwffcznksxxyepvpyjn:VictorVarone2026@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
```

Reemplazá **sólo la parte del query string al final** — cambiá `connection_limit=1` por `connection_limit=10&pool_timeout=15`. Debe quedar así:

```
DATABASE_URL="postgresql://postgres.rfwffcznksxxyepvpyjn:VictorVarone2026@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10&pool_timeout=15"
```

**Qué NO cambiar:**
- La password (`VictorVarone2026`).
- El host (`aws-1-us-east-2.pooler.supabase.com`).
- El puerto (`6543` — es el pooler transaction mode).
- El `pgbouncer=true`.
- Nada más del `.env`.

Guardá y salí.

Verificá con:

```bash
grep DATABASE_URL .env
```

Debe salir la línea nueva con `connection_limit=10&pool_timeout=15`.

**Por qué este cambio.** El backend Node del sistema Varone es single-instance (no serverless). Con `connection_limit=1` el pooler serializa todas las queries paralelas — `Promise.all([10 queries])` se ejecuta en serie sumando 10× la latencia round-trip Argentina ↔ Ohio (~1s por query = 10s de dashboard). Con `10` conexiones el pool sostiene el paralelismo real. Supabase Free permite ~200 conexiones vía pooler transaction mode, tenemos margen 20×. Detalle empírico completo vive en el monorepo Pampa Labs (`docs/vault/sessions/2026-07-07-LOG-sistema-varone-...`), no accesible desde este repo standalone.

---

## Paso 3 — Rebuild + restart de los servicios (5 min)

Docker Compose va a re-buildear las imágenes y levantar los contenedores con el código y el `.env` nuevos.

```bash
docker compose -f docker/docker-compose.yml -p sistema-varone down
docker compose -f docker/docker-compose.yml -p sistema-varone up -d --build
```

`--build` fuerza a que las imágenes se re-compilen con el código nuevo del `git pull`. `down` primero es más lento pero garantiza que no queden procesos viejos con la config vieja de la DB.

Esperá a que arranquen (30-60s). Confirmá que están UP:

```bash
docker compose -f docker/docker-compose.yml -p sistema-varone ps
```

Los servicios que deberían estar `Up`:
- `sistema-varone-backend-1` (o similar, en :3000)
- `sistema-varone-admin-1` (:3001)
- `sistema-varone-publisher-1` (:4001)
- `sistema-varone-nginx-1` (:80/:443 si aplica)

Si alguno queda `Restarting` o `Exited`, revisá logs con:

```bash
docker compose -f docker/docker-compose.yml -p sistema-varone logs --tail=100 <nombre-del-servicio>
```

y PARÁ. No sigas. Rollback abajo.

---

## Paso 4 — Verificación empírica (3 min)

### 4.1 Backend arrancó bien

```bash
docker compose -f docker/docker-compose.yml -p sistema-varone logs --tail=30 backend
```

Deberías ver algo tipo:
```
[DB] Conexión verificada.
[Cron] 6 scrapers registrados
[Dashboard] Disponible en http://localhost:3000
```

**NO debe aparecer:**
- `Timed out fetching a new connection from the connection pool` → significa que el `.env` no se levantó bien o `connection_limit` no cambió. Volvé al paso 2.
- Errores de auth Postgres → password mal escrita en `.env`, chequear.

### 4.2 Endpoints responden rápido

Necesitás el `BACKEND_API_TOKEN` (está en el `.env` como `BACKEND_API_TOKEN=...`).

```bash
TOKEN=$(grep BACKEND_API_TOKEN .env | cut -d= -f2 | tr -d '"')

# Primera corrida — cache miss real, debe ser 2-3s NO 10s
curl -o /dev/null -s -w "counters:      %{http_code} %{time_total}s\n" \
  -H "X-Backend-Token: $TOKEN" http://127.0.0.1:3000/api/dashboard/counters

curl -o /dev/null -s -w "scrapers:      %{http_code} %{time_total}s\n" \
  -H "X-Backend-Token: $TOKEN" http://127.0.0.1:3000/api/scrapers/status

# Segunda corrida — cache hit, debe ser <10ms
curl -o /dev/null -s -w "counters (hit): %{http_code} %{time_total}s\n" \
  -H "X-Backend-Token: $TOKEN" http://127.0.0.1:3000/api/dashboard/counters

curl -o /dev/null -s -w "scrapers (hit): %{http_code} %{time_total}s\n" \
  -H "X-Backend-Token: $TOKEN" http://127.0.0.1:3000/api/scrapers/status
```

Resultado esperado:
```
counters:      200 2.4s    ← cache miss, latencia Ohio + 10 counts en paralelo real
scrapers:      200 2.7s    ← cache miss, 18 queries en paralelo real
counters (hit): 200 0.002s ← cache hit
scrapers (hit): 200 0.001s ← cache hit
```

**Si counters devuelve `200 9.5s` o similar** → el `.env` no se levantó. `docker compose down` y `up -d --build` de nuevo, y verificá con `docker compose exec backend env | grep DATABASE_URL` que la nueva URL está adentro del contenedor.

**Si scrapers devuelve `500`** → mismo diagnóstico. El pool timeout sigue activo.

### 4.3 Feature nueva "Analizar URL" responde

```bash
curl -s -X POST http://127.0.0.1:3000/api/analizar-url \
  -H "Content-Type: application/json" \
  -H "X-Backend-Token: $TOKEN" \
  -d '{"url":"https://ejemplo-inexistente-para-smoke.com/test"}' \
  | head -c 500
```

Resultado esperado (el endpoint existe, aunque la URL sea trucha):
```json
{"ok":true,"encolado":true,"duplicado":false,"mensaje":"URL encolada..."}
```

Si sale `Cannot POST /api/analizar-url` significa que el código nuevo no está deployado — el `git pull` no trajo el commit `f6ccd4dd`/`1d2a69f5` o el rebuild no aplicó. Chequear con `git log --oneline -3`.

### 4.4 Panel admin carga rápido en el browser

Andá a `https://varone.pampalabs.com` (o el dominio que uses) y logueate. Abrí `/aprobacion`:
- El header debe mostrar el botón **"Analizar URL"** con ícono de link a la derecha del título.
- Los KPIs (Para aprobar / En publicación / Publicados / Errores / Descartados) deben pintarse en <1s en la segunda carga (primera puede tardar 2-3s por cache miss).
- Click en el botón "Analizar URL" abre un dialog modal donde podés pegar una URL. Cerrado y limpio.

Si algo de eso falla visualmente, revisá logs del admin:
```bash
docker compose -f docker/docker-compose.yml -p sistema-varone logs --tail=50 admin
```

---

## Paso 5 — Sanity check final (1 min)

```bash
docker compose -f docker/docker-compose.yml -p sistema-varone ps
```

Todos los servicios `Up` y sanos. Ninguno restarting.

Test empírico del cron nuevo (opcional, cada 3h corre solo):
```bash
docker compose -f docker/docker-compose.yml -p sistema-varone logs --tail=100 backend | grep -i "cron\|scraper"
```

Deberías ver `[Cron] 6 scrapers registrados` (o similar) en el arranque. La primera corrida del cron va a ser dentro de las próximas 0-3h dependiendo de qué hora sea.

**Listo.** El deploy quedó. Guardá el backup del `.env` viejo por si algo aparece raro en las próximas 24h:

```bash
ls -la .env.backup-perf-fix-2026-07-07
```

Podés borrarlo la semana que viene si todo funciona bien.

---

## Rollback (si algo salió mal)

**Escenario A: rebuild rompió algo pero el `.env` está OK.**

Volvé al commit anterior:
```bash
git log --oneline -5              # ver el SHA anterior a f6ccd4dd/1d2a69f5
git checkout <SHA_ANTERIOR>       # ej: 9149b1ee (feat portales custom)
docker compose -f docker/docker-compose.yml -p sistema-varone down
docker compose -f docker/docker-compose.yml -p sistema-varone up -d --build
```

**Escenario B: cambio del `.env` rompió la conexión a DB.**

Restaurar backup:
```bash
cp .env.backup-perf-fix-2026-07-07 .env
docker compose -f docker/docker-compose.yml -p sistema-varone restart backend
```

**Escenario C: querés volver todo al estado previo.**

Combinás A + B: `git checkout <SHA>` + `cp .env.backup .env` + `down` + `up -d --build`.

---

## Diferencias con el deploy original

El deploy original (2026-06 desde el HANDOFF) documentaba `connection_limit=1`. Ese valor era el bug que este runbook corrige. Si en el futuro se re-clona el repo desde cero para un VPS nuevo, seguir las instrucciones actualizadas del `HANDOFF-NUEVO-DEV.md` (ya trae `connection_limit=10&pool_timeout=15` como default recomendado).

---

## Referencias

- Session log completo del sprint + 2 LLs (Supabase pooler + scraper solo portada) viven en el monorepo Pampa Labs bajo `docs/vault/sessions/` y `docs/vault/lessons-learned/`. Este repo standalone es sólo el código deployable.
- Docs producto en este repo: `HANDOFF-NUEVO-DEV.md` (con sección troubleshooting perf actualizada 2026-07-07) + `CLAUDE.md` (contexto técnico).
- Docs producto: `products/sistema-varone/CLAUDE.md` en el monorepo o `CLAUDE.md` raíz en el standalone.
- HANDOFF con la config actualizada: `products/sistema-varone/HANDOFF-NUEVO-DEV.md`.

---

**Commits que este runbook deploya:**
- Monorepo `jorgeleporace/Pampa-Labs-Core`: `f6ccd4dd` + `076ed1d4`.
- Standalone `fabioB33/SistemaVarone`: `1d2a69f5` + `dfce3c07`.
