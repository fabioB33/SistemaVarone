/**
 * Sprint perf-fix (2026-07-07) — Cache in-memory con TTL.
 *
 * Motivación empírica: cada round-trip a Supabase Ohio cuesta ~1s. El
 * dashboard hace ~10 counts en paralelo para pintar KPIs → con el pooler y
 * connection_limit=10 baja a ~1s, pero seguimos pagando esa segunda por cada
 * refresh de navegación. Este cache lo elimina para pantallas de lectura
 * donde 5-60s de staleness es tolerable (Varone no toma decisiones en tiempo
 * real desde los KPIs, y el flujo de aprobación no lee de acá).
 *
 * Diseño intencionalmente mínimo:
 *   - Map en memoria del proceso (single-instance backend, no cluster).
 *   - TTL fijo por entry, se re-computa el getter cuando expira.
 *   - Single-flight: si N requests llegan simultáneos con miss, sólo 1 va a
 *     DB — los otros esperan la misma Promise. Evita thundering herd.
 *   - `invalidatePrefix()` para bustear manualmente cuando cambia data
 *     (ej: al aprobar un reporte, invalidar `counters:*`).
 *
 * NO usar para:
 *   - Reads que Varone ve cambiar y hacer un mutation acto seguido
 *     (ej: la lista de /aprobacion — se sirve directo, no cacheable).
 *   - Cualquier cosa con datos por-usuario. Este cache es global.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Retorna el valor cacheado si está fresco. Si no, invoca `getter()`,
 * guarda el resultado con TTL y lo devuelve. Si múltiples calls concurrentes
 * miss al mismo tiempo, sólo 1 ejecuta `getter()` — el resto espera.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  getter: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  // Single-flight: si ya hay un fetch en curso para esta key, esperar el mismo.
  const existingInflight = inflight.get(key);
  if (existingInflight) {
    return existingInflight as Promise<T>;
  }

  const promise = (async () => {
    try {
      const value = await getter();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Invalida todas las entries cuya key empieza con `prefix`. Usado desde
 * mutations para forzar refresh en el próximo GET.
 *
 * Ej: al aprobar un reporte → invalidatePrefix('counters:') fuerza que el
 * próximo GET /api/dashboard/counters vuelva a leer DB con datos frescos.
 */
export function invalidatePrefix(prefix: string): number {
  let count = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      count++;
    }
  }
  return count;
}

/** Utilitario para tests / debug. */
export function clearAll(): void {
  store.clear();
  inflight.clear();
}
