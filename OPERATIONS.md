# Sistema Varone — Operaciones

Guía operativa para mantener el sistema corriendo en producción.

## Procesos del sistema

3 servicios independientes que se levantan en este orden:

```bash
# 1) Microservicio Framer (publica noticias en el CMS)
cd framer-publisher && npm run dev   # puerto 4001

# 2) Backend (WhatsApp + IA + DB + cron)
npm run dev                           # puerto 3000

# 3) Panel admin (UI Next.js)
cd varone-admin && npm run dev        # puerto 3001
```

## Notificaciones por WhatsApp

Cada vez que llega un reporte nuevo a la cola de aprobación, Varone recibe un mensaje al número configurado (`VARONE_WA_NUMBER`) con:

- 🚨 Tipo de incidente y ubicación
- 📅 Fecha
- _Resumen_
- ✅ Link **Aprobar** (firmado HMAC, expira en 24h)
- ❌ Link **Descartar** (firmado HMAC, expira en 24h)
- 📋 Link al panel para edición completa

Los links de Aprobar/Descartar funcionan **sin login**: el token HMAC ya valida la acción. El secret se configura con `QUICK_ACTION_SECRET` (mín 32 chars).

### Cuando un link expira

Los tokens duran 24h por seguridad. Si Varone llega tarde, abre el panel normalmente con login.

## Auto-recovery de WhatsApp

El bot detecta y se recupera automáticamente de:

- **Desconexión transitoria** — backoff exponencial (10s → 5min máx, hasta 10 reintentos)
- **Auth failure** — reintenta tras 30s sin borrar la sesión local
- **Zombie watchdog** — si no recibe ningún mensaje por 6h, fuerza un reinicio del cliente

### Alertas que recibe Varone

| Cuando | Mensaje |
|---|---|
| Desconexión > 3 min | ⚠️ "WhatsApp desconectado hace Xm. Reintentando." |
| 10 reintentos fallidos | 🚨 "ALERTA CRÍTICA — intervención manual requerida" |
| Auth failure | 🔐 "WhatsApp rechazó credenciales. Reintentando." |
| Reconexión exitosa | ✅ "Reconectado tras Xm Ys de downtime" |

### Si la sesión se corrompe (raro)

```bash
# Detener el backend
# Borrar la carpeta de sesión
rm -rf .wwebjs_auth/
# Reiniciar — aparecerá un QR nuevo en el panel para escanear
npm run dev
```

## Backups

Cron diario a las **3:00 AM Argentina** ejecuta `pg_dump -Fc` y guarda el archivo en `backups/varone-YYYY-MM-DD.dump`. Retención: 30 días por default.

### Requisito previo

Tener instalado el cliente PostgreSQL en el servidor:

```bash
# Ubuntu / Debian
sudo apt install postgresql-client

# Verificar
which pg_dump
```

### Variables relevantes

```bash
BACKUP_DIR=backups               # default: ./backups
BACKUP_RETAIN_DAYS=30            # cuántos días mantener
```

### Ejecutar backup manual

Desde el panel: `POST /api/backups/run` (requiere auth).

Desde shell:

```bash
TOKEN=$(grep BACKEND_API_TOKEN .env | cut -d= -f2)
curl -X POST http://127.0.0.1:3000/api/backups/run \
  -H "X-Backend-Token: $TOKEN"
```

### Listar backups

```bash
curl http://127.0.0.1:3000/api/backups/status \
  -H "X-Backend-Token: $TOKEN"
```

### Restaurar un backup

```bash
# Detener el backend para evitar conflictos
# Restaurar (reemplaza la DB actual)
PGPASSWORD=varone_secret pg_restore \
  -h localhost -U varone -d sistema_varone \
  --clean --if-exists \
  backups/varone-2026-05-01.dump

# Reiniciar el backend
npm run dev
```

⚠️ `--clean --if-exists` borra las tablas existentes y las recrea desde el dump. **Asegurate de tener el archivo correcto antes de ejecutar.**

## Troubleshooting

### "WhatsApp esperando QR" en el panel

La sesión expiró o el bot no terminó de inicializar. Esperá 30s y refrescá. Si persiste, escaneá el QR.

### Reportes que no llegan a Framer

El sistema reintenta automáticamente cada 15min los reportes en estado `aprobado` que no llegaron a Framer. Verificar:

1. `framer-publisher` esté corriendo (curl http://127.0.0.1:4001/health)
2. `FRAMER_API_KEY` esté vigente (no rotada/expirada)
3. Logs del publisher: `tail -f /tmp/varone-logs/publisher.log`

### Backup falla con "pg_dump no disponible"

Falta instalar `postgresql-client` (ver sección Backups).

### Panel admin muestra "Backend no responde"

El panel hace polling al backend cada 3s. Si lo ves, el backend (:3000) está caído. Reiniciar:

```bash
ss -tlnp | grep :3000   # ver si corre
npm run dev             # arrancar
```

## Variables de entorno

Ver [.env.example](.env.example) — todas documentadas. Las más críticas:

- `DATABASE_URL` — conexión Postgres
- `GEMINI_API_KEY` — IA de clasificación
- `WA_GROUP_NAME` — nombre EXACTO del grupo a monitorear
- `VARONE_WA_NUMBER` — destino de las notificaciones
- `FRAMER_PUBLISHER_URL` + `FRAMER_PUBLISHER_TOKEN` — microservicio Framer
- `BACKEND_API_TOKEN` — bypass auth server-to-server (compartido con varone-admin)
- `QUICK_ACTION_SECRET` — firma HMAC de los links Aprobar/Descartar
- `ADMIN_PUBLIC_URL` — base URL del panel para los links de notificaciones
