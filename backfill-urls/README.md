# Backfill URLs — sistema-varone

Archivos con URLs de noticias históricas del nicho piratería del asfalto/robo de camiones que están listas para inyectar al pipeline vía `POST /api/analizar-url` (o el script `scripts/analizar-batch.sh`).

## Cómo usar

```bash
# Desde la raíz del proyecto
./scripts/analizar-batch.sh backfill-urls/2026-07-08-urls-nuevas-listas-para-inyectar.txt
```

El script:
- Lee el archivo (ignora comentarios `#` y líneas vacías).
- Inyecta cada URL con throttle 3s (para no saturar Gemini API).
- Reporta encoladas / duplicadas / errores.

## ⚠️ Restricción crítica — Gemini free tier

**20 requests/día máximo.** Antes de ejecutar el batch grande:

1. Chequear cuota disponible del día: `grep -c "429 Too Many Requests" /tmp/varone-backend.log`
2. Dejar 5 requests de margen para los scrapers automáticos.
3. Con free tier, máximo **~15 URLs/día**.

Cuota se resetea a las **00:00 UTC = 21:00 hora Argentina**.

Para procesar todo de una vez, activar billing en https://aistudio.google.com/app/apikey (~10 min + tarjeta). Costo estimado: <$1 USD para 37 URLs.

## Archivos disponibles

### `2026-07-08-urls-nuevas-listas-para-inyectar.txt` (55 URLs)

Recolectadas vía WebSearch (Anthropic tool) el 2026-07-08 en 3 rondas de queries. Cobertura por mes:

| Mes | URLs |
|---|---:|
| 2025-08 | 0 ⚠️ (sin cobertura mediática en el nicho ese mes) |
| 2025-09 | 7 |
| 2025-10 | 4 |
| 2025-11 | 4 |
| 2025-12 | 8 |
| 2026-01 | 5 |
| 2026-02 | 2 |
| 2026-03 | 3 |
| 2026-04 | 5 |
| 2026-05 | 9 |
| 2026-06 | 5 |
| 2026-07 | 3 |

Fuentes empíricas:
- **Infobae**: 47 URLs (fuente principal, formato `/sociedad/policiales/YYYY/MM/DD/slug/` + algunas de `/sociedad/YYYY/MM/DD/slug/` para volcados y saqueos).
- **La Nación**: 8 URLs (formato `/seguridad/slug-nidDDMMYYYY/`).

Portales que NO funcionaron para WebSearch:
- **Clarín**: bloqueado (HTTP 400) para el user agent de Anthropic.
- **Crónica, Diario Popular, Página 12**: no tienen URLs relevantes del nicho en el rango solicitado.

Dedup contra DB al momento de recolección:
- 55 nuevas
- 2 duplicadas (ya en `reportes` desde sesiones anteriores)

## Cuándo agregar más archivos

Cuando se ejecute otro backfill (por ejemplo, agosto 2026 o cuando Varone reporte notas específicas), crear un nuevo archivo con formato `YYYY-MM-DD-descripcion.txt`. Nunca modificar archivos previos — mantener trazabilidad histórica.
