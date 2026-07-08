#!/usr/bin/env bash
#
# Sprint 2026-07-08 — Batch inject URLs manuales al pipeline sistema-varone.
#
# Uso:
#   1. Editar el archivo `urls-para-analizar.txt` con 1 URL por línea (vacías
#      y las que empiezan con # se ignoran).
#   2. Correr:  ./scripts/analizar-batch.sh
#      (o desde otra ruta: bash /path/to/scripts/analizar-batch.sh)
#
# Ejemplo del archivo `urls-para-analizar.txt`:
#
#   # Batch Q3 2025 — piratas del asfalto
#   https://www.infobae.com/sociedad/policiales/2025/09/12/atraparon-a-tres-piratas.../
#   https://www.infobae.com/sociedad/policiales/2025/09/25/desbarataron-una-banda.../
#
# Requiere:
#   - Backend corriendo en http://127.0.0.1:3000 (npm run dev)
#   - Variable BACKEND_API_TOKEN en el .env
#   - jq instalado (sudo apt install jq)
#
# Throttle: 3s entre requests (evita rate-limit de Gemini API).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
URLS_FILE="${1:-$PROJECT_DIR/urls-para-analizar.txt}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3000}"

# Lee el token del .env del proyecto.
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "❌ No encuentro $PROJECT_DIR/.env"
  exit 1
fi

TOKEN=$(grep -E "^BACKEND_API_TOKEN=" "$PROJECT_DIR/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
if [[ -z "$TOKEN" ]]; then
  echo "❌ BACKEND_API_TOKEN no está definido en $PROJECT_DIR/.env"
  exit 1
fi

if [[ ! -f "$URLS_FILE" ]]; then
  echo "❌ No encuentro el archivo con URLs: $URLS_FILE"
  echo ""
  echo "Creá el archivo con 1 URL por línea:"
  echo "  nano $URLS_FILE"
  exit 1
fi

# Chequeo backend UP (fast fail antes de arrancar el loop).
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BACKEND_URL/api/dashboard/counters" \
    -H "X-Backend-Token: $TOKEN" | grep -q "200"; then
  echo "❌ Backend no responde en $BACKEND_URL"
  echo "   Verificá que esté corriendo: cd $PROJECT_DIR && npm run dev"
  exit 1
fi

# Chequeo jq disponible.
if ! command -v jq &> /dev/null; then
  echo "❌ jq no está instalado. Instalalo con: sudo apt install jq"
  exit 1
fi

# Filtra líneas vacías y comentarios, cuenta URLs válidas.
URLS=$(grep -vE '^\s*(#|$)' "$URLS_FILE" || true)
TOTAL=$(echo "$URLS" | grep -c "^http" || true)

if [[ "$TOTAL" -eq 0 ]]; then
  echo "❌ No hay URLs en $URLS_FILE"
  echo "   Agregá una URL por línea (líneas con # o vacías se ignoran)."
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════════"
echo "  BATCH — inyección de $TOTAL URLs a $BACKEND_URL"
echo "  Archivo: $URLS_FILE"
echo "  Throttle: 3s entre requests (evita rate-limit Gemini)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Contadores para el resumen final.
count=0
encoladas=0
duplicadas=0
errores=0

# Loop URL por URL.
while IFS= read -r url; do
  # Ignora líneas vacías y comentarios.
  if [[ -z "${url// }" ]] || [[ "$url" =~ ^# ]]; then
    continue
  fi

  count=$((count+1))
  short=$(echo "$url" | sed 's|.*/||' | cut -c1-55)
  echo "[$count/$TOTAL] $short..."

  # POST al endpoint. Silenciamos stderr para leer solo el body JSON.
  response=$(curl -s -X POST "$BACKEND_URL/api/analizar-url" \
    -H "Content-Type: application/json" \
    -H "X-Backend-Token: $TOKEN" \
    -d "{\"url\":\"$url\"}" 2>/dev/null || echo '{"ok":false,"error":"curl fallo"}')

  # Parseo del response con jq.
  ok=$(echo "$response" | jq -r '.ok // false')
  encolado=$(echo "$response" | jq -r '.encolado // false')
  duplicado=$(echo "$response" | jq -r '.duplicado // false')
  error=$(echo "$response" | jq -r '.error // ""')

  if [[ "$ok" == "true" && "$encolado" == "true" ]]; then
    encoladas=$((encoladas+1))
    echo "        ✅ Encolada para análisis (aparecerá en pendientes en 10-30s)"
  elif [[ "$ok" == "true" && "$duplicado" == "true" ]]; then
    reporte_id=$(echo "$response" | jq -r '.reporte.id // "?"')
    reporte_estado=$(echo "$response" | jq -r '.reporte.estado // "?"')
    duplicadas=$((duplicadas+1))
    echo "        🔁 Duplicada — reporte #$reporte_id ya existe (estado: $reporte_estado)"
  else
    errores=$((errores+1))
    echo "        ❌ Error: $error"
  fi

  echo ""

  # Throttle. Última iteración no espera.
  if [[ "$count" -lt "$TOTAL" ]]; then
    sleep 3
  fi
done <<< "$URLS"

echo "═══════════════════════════════════════════════════════════════════"
echo "  RESUMEN"
echo "═══════════════════════════════════════════════════════════════════"
echo "  Total procesadas:  $count"
echo "  ✅ Encoladas:       $encoladas"
echo "  🔁 Duplicadas:      $duplicadas"
echo "  ❌ Errores:         $errores"
echo ""
echo "  Las URLs encoladas van a estar analizadas por IA en los próximos"
echo "  60-90 segundos. Abrí el panel para verlas:"
echo "  http://localhost:3001/aprobacion"
echo ""
