/**
 * Sprint mapa (2026-06-27) — Geocoder service.
 *
 * Convierte "ubicacion + ruta + provincia" → coordenadas (lat, lng) usando
 * Nominatim (OpenStreetMap oficial, free). Cachea en `ubicaciones_geocoded`.
 *
 * Reglas Nominatim TOS:
 * - Max 1 request por segundo.
 * - User-Agent identificable (configurado en ENV).
 * - Cachear localmente (eso hacemos).
 *
 * Si necesitamos más volumen o precisión, swap a Mapbox o Google Maps via
 * `NOMINATIM_BASE_URL` (apuntando a self-hosted) o nuevo provider.
 */

import { ENV } from '../config/env';
import prisma from './prisma';
import logger from './logger';
import { captureException } from '../lib/sentry';

interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

/**
 * Construye la query de búsqueda con la mejor info disponible.
 * Argentina-bias: incluye "Argentina" para evitar matches en España u otros.
 */
export function buildQuery(ubicacion: string, ruta: string | null, provincia: string | null): string {
  const parts: string[] = [];
  if (ubicacion) parts.push(ubicacion);
  if (ruta) parts.push(ruta);
  if (provincia) parts.push(provincia);
  parts.push('Argentina');
  return parts.filter(Boolean).join(', ');
}

/**
 * Pega 1 vez a Nominatim. NO cachea — solo HTTP + parse.
 * Retorna null si no encontró match (sin tirar error).
 */
export async function geocodearNominatim(query: string): Promise<GeocodeResult | null> {
  const url = new URL(`${ENV.NOMINATIM_BASE_URL}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ar'); // bias Argentina
  url.searchParams.set('accept-language', 'es');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': ENV.NOMINATIM_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`);
  }

  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data.length) return null;

  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    displayName: data[0].display_name,
  };
}

/**
 * Resuelve una ubicación a coordenadas:
 * 1. Cache hit → retorna.
 * 2. Cache miss → llama a Nominatim, persiste resultado (éxito o notFound), retorna.
 *
 * No respeta throttle 1 req/seg en este método — el caller (cron batch) sí.
 */
export async function resolverCoordenadas(
  ubicacion: string,
  ruta: string | null = null,
  provincia: string | null = null,
): Promise<{ lat: number; lng: number; cached: boolean; notFound: boolean } | null> {
  if (!ubicacion || !ubicacion.trim()) return null;

  // Cache hit
  const cached = await prisma.ubicacionGeocoded.findUnique({
    where: { ubicacion },
  });
  if (cached) {
    if (cached.notFound || cached.lat == null || cached.lng == null) {
      return { lat: 0, lng: 0, cached: true, notFound: true };
    }
    return { lat: cached.lat, lng: cached.lng, cached: true, notFound: false };
  }

  // Cache miss — geocodear
  const query = buildQuery(ubicacion, ruta, provincia);
  try {
    const result = await geocodearNominatim(query);
    if (!result) {
      await prisma.ubicacionGeocoded.create({
        data: { ubicacion, notFound: true, provider: 'nominatim' },
      });
      logger.info(`[Geocoder] notFound: "${query}"`);
      return { lat: 0, lng: 0, cached: false, notFound: true };
    }
    await prisma.ubicacionGeocoded.create({
      data: {
        ubicacion,
        lat: result.lat,
        lng: result.lng,
        displayName: result.displayName,
        provider: 'nominatim',
      },
    });
    logger.info(`[Geocoder] OK "${query}" → ${result.lat.toFixed(4)},${result.lng.toFixed(4)}`);
    return { lat: result.lat, lng: result.lng, cached: false, notFound: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[Geocoder] error "${query}": ${msg}`);
    captureException(err, { service: 'geocoder', query });
    // NO persistimos como notFound porque el error puede ser transient
    // (network glitch). El próximo intento del cron va a reintentar.
    return null;
  }
}

/**
 * Cron job: agarra ubicaciones nuevas (reportes sin geocoded) y las procesa.
 * Respeta throttle Nominatim entre cada request.
 *
 * Idempotente: re-llamarlo no duplica work (gracias al cache).
 */
export async function geocodingBatchCron(): Promise<{ procesadas: number; nuevas: number; fallidas: number }> {
  // Encontrar ubicaciones únicas de reportes que NO están todavía en el cache.
  // SQL crudo es más eficiente que cargar todos los reportes a memoria.
  const ubicacionesNuevas = await prisma.$queryRaw<Array<{ ubicacion: string; ruta: string | null; provincia: string | null }>>`
    SELECT DISTINCT r.ubicacion, r.ruta, r.provincia
    FROM reportes r
    LEFT JOIN ubicaciones_geocoded u ON u.ubicacion = r.ubicacion
    WHERE u.id IS NULL
    LIMIT ${ENV.GEOCODE_BATCH_SIZE}
  `;

  let nuevas = 0;
  let fallidas = 0;

  for (const { ubicacion, ruta, provincia } of ubicacionesNuevas) {
    const result = await resolverCoordenadas(ubicacion, ruta, provincia);
    if (result === null) fallidas++;
    else nuevas++;

    // Throttle Nominatim TOS. Solo si no fue cache hit (que no llamó a la red).
    if (result && !result.cached) {
      await new Promise((r) => setTimeout(r, ENV.GEOCODE_THROTTLE_MS));
    }
  }

  if (ubicacionesNuevas.length > 0) {
    logger.info(`[Geocoder] batch: ${nuevas} nuevas, ${fallidas} fallidas, ${ubicacionesNuevas.length} total procesadas`);
  }

  return {
    procesadas: ubicacionesNuevas.length,
    nuevas,
    fallidas,
  };
}

/** Stats para el panel. */
export async function statsGeocoding(): Promise<{ total: number; resueltas: number; notFound: number; pendientes: number }> {
  const [total, notFound] = await Promise.all([
    prisma.ubicacionGeocoded.count(),
    prisma.ubicacionGeocoded.count({ where: { notFound: true } }),
  ]);

  // Ubicaciones únicas en reportes que NO están en cache
  const pendientesResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT r.ubicacion) as count
    FROM reportes r
    LEFT JOIN ubicaciones_geocoded u ON u.ubicacion = r.ubicacion
    WHERE u.id IS NULL
  `;
  const pendientes = Number(pendientesResult[0]?.count ?? 0);

  return {
    total,
    resueltas: total - notFound,
    notFound,
    pendientes,
  };
}
