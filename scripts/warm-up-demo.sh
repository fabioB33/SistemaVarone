#!/usr/bin/env bash
# Sprint sugerencias-extras (2026-06-30) — Warm-up para demo.
#
# Pre-compila las páginas Next.js antes de la demo para que el primer click de
# Varone sea instantáneo (sin esperar la compilación incremental).
#
# Uso:
#   ./scripts/warm-up-demo.sh
#
# Requiere:
#   - Backend :3000 corriendo
#   - Admin :3001 corriendo
#   - Credenciales del .env de varone-admin

set -e

ADMIN_URL="${ADMIN_URL:-http://localhost:3001}"
USER="${ADMIN_USER:-varone}"
PASS="${ADMIN_PASS:-varone2026}"
COOKIE_JAR=$(mktemp)
trap "rm -f $COOKIE_JAR" EXIT

echo "▶ Warm-up Sistema Varone demo"
echo "  Admin: $ADMIN_URL"
echo

echo "1/2 Login..."
RES=$(curl -s -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"user\":\"$USER\",\"pass\":\"$PASS\"}" \
  "$ADMIN_URL/api/auth/login")
if ! echo "$RES" | grep -q '"ok":true'; then
  echo "  ✗ Login falló: $RES"
  exit 1
fi
echo "  ✓ OK"

echo
echo "2/2 Pre-compilar páginas (Next.js dev mode)..."
for path in /dashboard /aprobacion /aprobacion?estado=aprobado /aprobacion?estado=publicado /aprobacion?estado=descartado /mapa /descartados /errores-publicacion; do
  CODE=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" -m 30 "$ADMIN_URL$path" || echo "TIMEOUT")
  printf "  %-45s → %s\n" "$path" "$CODE"
done

echo
echo "✓ Warm-up completo. Las páginas están pre-compiladas y rinden instantáneo."
