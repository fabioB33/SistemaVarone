/**
 * Cliente del backend Sistema Varone.
 *
 * Se invoca solo desde Server Components y Server Actions: las credenciales
 * nunca llegan al browser. El backend Express acepta un bypass por header
 * `X-Backend-Token` que tiene que coincidir con `BACKEND_API_TOKEN` del
 * propio backend. Acá lo leemos de `BACKEND_API_TOKEN` del .env.local.
 *
 * Si `BACKEND_API_TOKEN` no está seteado, los requests pegarán 401 contra
 * el backend (el dashboard exige login con cookie/token de sesión).
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_SISTEMA_VARONE_URL || 'http://127.0.0.1:3000';

export interface ReporteListItem {
  id: number;
  estado: string;
  fecha: string;
  hora: string | null;
  ubicacion: string;
  ruta: string;
  tipoIncidente: string;
  gravedad: string | null;
  descripcion: string;
  fuente: string;
  urlNoticia: string | null;
  framerItemId: string | null;
  framerSlug: string | null;
  ogImageUrl: string | null;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  creadoEn: string;

  // Sprint pivot-framer-form (2026-06-26)
  provincia: string | null;
  tipoIncidenteFramer: string | null;
  fuerzaInterviniente: string | null;
  tipoVehiculo: string | null;
  cargaTransportada: string | null;
  modusOperandi: string | null;
  huboViolencia: string | null;
  tipoVehiculoInvolucrado: string | null;
  cantidadVehiculosInvolucrados: string | null;
  cantidadPersonasInvolucradas: string | null;
  camposFaltantes: string[];

  // Sprint scrapers-portales (2026-06-30): metadata del scraping si fuente='scraping'.
  portalOrigen: string | null;
  tituloOriginal: string | null;
  publishedAt: string | null;
}

// Sprint scrapers-portales (2026-06-30)
export interface ScrapeDescartadoItem {
  id: number;
  portal: string;
  url: string | null;
  titulo: string;
  resumen: string | null;
  razon: 'blacklist' | 'sin-keywords';
  matchedKeywords: string[];
  descartadoEn: string;
}

export interface DescartadosCount {
  total: number;
  porPortal: Array<{ portal: string; _count: number }>;
}

interface BackendResponse<T> {
  ok: boolean;
  error?: string;
  estado?: string;
  items?: T;
  framerItemId?: string;
  framerSlug?: string;
  deploymentId?: string;
  promovidos?: number;
  reporte?: ReporteListItem;
}

export type ReporteEditableFields = Partial<{
  ubicacion: string;
  ruta: string;
  tipoIncidente: string;
  gravedad: string | null;
  descripcion: string;
  fecha: string;
  hora: string | null;
  vehiculo: string | null;
  patente: string | null;
  victimas: string | null;
  detenidos: string | null;
  urlNoticia: string | null;
  ogImageUrl: string | null;

  // Sprint pivot-framer-form (2026-06-26)
  provincia: string | null;
  tipoIncidenteFramer: string | null;
  fuerzaInterviniente: string | null;
  tipoVehiculo: string | null;
  cargaTransportada: string | null;
  modusOperandi: string | null;
  huboViolencia: string | null;
  tipoVehiculoInvolucrado: string | null;
  cantidadVehiculosInvolucrados: string | null;
  cantidadPersonasInvolucradas: string | null;
}>;

async function backendFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<BackendResponse<T>> {
  const url = `${BACKEND_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  const backendToken = process.env.BACKEND_API_TOKEN;
  if (backendToken) {
    headers['X-Backend-Token'] = backendToken;
  }

  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  let json: BackendResponse<T> = { ok: false };
  try {
    json = (await res.json()) as BackendResponse<T>;
  } catch {
    // Algunas rutas devuelven texto vacío
  }

  if (!res.ok && !json.error) {
    json.error = `HTTP ${res.status}`;
  }
  return json;
}

export type EstadoReporte =
  | 'pendiente'
  | 'pendiente_revision'
  | 'aprobado'
  | 'publicado'
  | 'descartado'
  | 'fallo_publicacion';

export async function listarReportes(
  estado: EstadoReporte,
): Promise<ReporteListItem[]> {
  const r = await backendFetch<ReporteListItem[]>(
    `/api/aprobacion/lista?estado=${estado}&limit=100`,
  );
  return r.items || [];
}

/**
 * Sprint pivot-framer-form: cuenta reportes en pendiente_revision para el
 * badge del topbar.
 */
export async function contarPendientesRevision(): Promise<number> {
  const r = await backendFetch<unknown>('/api/aprobacion/contar-pendientes-revision');
  return (r as unknown as { count?: number }).count ?? 0;
}

/**
 * Sprint hardening 13-mejoras (2026-06-27): reintenta UN reporte específico
 * de `fallo_publicacion`. Resetea intentos y dispara enviarAFramer inmediato.
 */
export async function reintentarUnReporte(id: number): Promise<{ ok: boolean; error?: string }> {
  return backendFetch(`/api/framer/reintentar-uno/${id}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Sprint mapa (2026-06-27): reporte con coordenadas para el mapa Leaflet.
 */
export interface ReporteGeoItem {
  id: number;
  fecha: string;
  hora: string | null;
  ubicacion: string;
  ruta: string;
  tipo_incidente: string;
  gravedad: string | null;
  descripcion: string;
  estado: string;
  lat: number;
  lng: number;
}

export interface ReportesGeoFiltros {
  desde?: string;
  hasta?: string;
  tipo?: string;
  provincia?: string;
}

export async function listarReportesGeo(
  filtros: ReportesGeoFiltros = {},
): Promise<ReporteGeoItem[]> {
  const params = new URLSearchParams();
  if (filtros.desde) params.set('desde', filtros.desde);
  if (filtros.hasta) params.set('hasta', filtros.hasta);
  if (filtros.tipo) params.set('tipo', filtros.tipo);
  if (filtros.provincia) params.set('provincia', filtros.provincia);
  const qs = params.toString();
  const r = await backendFetch<ReporteGeoItem[]>(
    `/api/reportes/geo${qs ? '?' + qs : ''}`,
  );
  return r.items || [];
}

export interface GeocodingStats {
  total: number;
  resueltas: number;
  notFound: number;
  pendientes: number;
}

export async function obtenerStatsGeocoding(): Promise<GeocodingStats | null> {
  const r = await backendFetch<unknown>('/api/ubicaciones/stats');
  if (!r.ok) return null;
  const raw = r as unknown as GeocodingStats;
  return {
    total: raw.total ?? 0,
    resueltas: raw.resueltas ?? 0,
    notFound: raw.notFound ?? 0,
    pendientes: raw.pendientes ?? 0,
  };
}

export async function dispararGeocodingBatch(): Promise<{ ok: boolean; procesadas?: number; nuevas?: number; fallidas?: number; error?: string }> {
  return backendFetch('/api/ubicaciones/geocodear-batch', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function aprobarReporte(
  id: number,
  aprobadoPor: string,
): Promise<{ ok: boolean; error?: string; framerItemId?: string; framerSlug?: string }> {
  return backendFetch('/api/aprobacion/aprobar', {
    method: 'POST',
    body: JSON.stringify({ id, aprobadoPor }),
  });
}

export async function descartarReporte(
  id: number,
  descartadoPor: string,
): Promise<{ ok: boolean; error?: string }> {
  return backendFetch('/api/aprobacion/descartar', {
    method: 'POST',
    body: JSON.stringify({ id, descartadoPor }),
  });
}

/**
 * Despublica un reporte ya publicado/aprobado.
 * Borra el item de Framer, re-publica el sitio, marca como descartado en DB.
 * Bypass humano para corregir errores de la IA en modo full-auto.
 */
export async function despublicarReporte(
  id: number,
  despublicadoPor: string,
): Promise<{ ok: boolean; error?: string }> {
  return backendFetch('/api/aprobacion/despublicar', {
    method: 'POST',
    body: JSON.stringify({ id, despublicadoPor }),
  });
}

export async function editarReporteBackend(
  id: number,
  cambios: ReporteEditableFields,
  editorPor: string,
): Promise<{ ok: boolean; error?: string; reporte?: ReporteListItem }> {
  return backendFetch('/api/aprobacion/editar', {
    method: 'POST',
    body: JSON.stringify({ id, cambios, editorPor }),
  });
}

export async function publicarSitioFramer(): Promise<{
  ok: boolean;
  error?: string;
  deploymentId?: string;
  promovidos?: number;
}> {
  return backendFetch('/api/framer/publicar', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ─── Alertas operativas ─────────────────────────────────────────────────────

export interface AlertaItem {
  id: number;
  tipo: 'silencio' | 'spike' | 'pendientes-viejos' | 'distribucion' | 'test';
  mensaje: string;
  severidad: 'info' | 'warn' | 'error';
  meta: Record<string, unknown> | null;
  estadoEnvio: 'pending' | 'sent' | 'failed' | 'fallback-console';
  vistaEn: string | null;
  resueltaEn: string | null;
  creadoEn: string;
}

export async function listarAlertas(opts?: {
  soloSinLeer?: boolean;
  tipo?: string;
  limit?: number;
}): Promise<AlertaItem[]> {
  const params = new URLSearchParams();
  if (opts?.soloSinLeer) params.set('soloSinLeer', 'true');
  if (opts?.tipo) params.set('tipo', opts.tipo);
  params.set('limit', String(opts?.limit ?? 50));
  const r = await backendFetch<AlertaItem[]>(`/api/alertas?${params.toString()}`);
  return r.items || [];
}

export async function contarAlertasSinLeer(): Promise<number> {
  const r = await backendFetch<unknown>('/api/alertas/sin-leer/count');
  return (r as unknown as { count?: number }).count ?? 0;
}

export async function marcarAlertaVista(id: number): Promise<{ ok: boolean; error?: string }> {
  return backendFetch('/api/alertas/marcar-vista', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export async function marcarTodasAlertasVistas(): Promise<{ ok: boolean; marcadas?: number; error?: string }> {
  return backendFetch('/api/alertas/marcar-todas-vistas', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface WaStatus {
  status: 'connected' | 'qr' | 'disconnected';
  qr: string | null;             // dataURL PNG si status === 'qr'
  /** True si el cliente WA todavía no emitió ningún evento real
   *  (estado mostrado viene del último persistido en DB). */
  cargando?: boolean;
  groupName: string | null;
  pendientes: number;
  ultimoReporteEn: string | null;
  ahora: string;
}

/**
 * Estado consolidado de WhatsApp para el panel.
 * Devuelve `null` si el backend no responde (status temporal).
 */
export async function obtenerWaStatus(): Promise<WaStatus | null> {
  try {
    const url = `${BACKEND_URL}/api/wa/status`;
    const headers: Record<string, string> = {};
    const backendToken = process.env.BACKEND_API_TOKEN;
    if (backendToken) headers['X-Backend-Token'] = backendToken;
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as WaStatus;
  } catch {
    return null;
  }
}

// ─── Sprint scrapers-portales (2026-06-30) ──────────────────────────────────

export async function listarDescartados(opts?: {
  portal?: string;
  razon?: 'blacklist' | 'sin-keywords';
  limit?: number;
}): Promise<ScrapeDescartadoItem[]> {
  const params = new URLSearchParams();
  if (opts?.portal) params.set('portal', opts.portal);
  if (opts?.razon) params.set('razon', opts.razon);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const r = await backendFetch<ScrapeDescartadoItem[]>(`/api/descartados/lista?${params.toString()}`);
  return r.items || [];
}

export async function contarDescartados(): Promise<DescartadosCount> {
  const r = await backendFetch<unknown>('/api/descartados/count');
  return (r as unknown as DescartadosCount) || { total: 0, porPortal: [] };
}

export async function correrScraperManual(portal: string): Promise<{
  ok: boolean;
  error?: string;
  portal?: string;
  notasScrapeadas?: number;
  pasaronPrefiltro?: number;
  descartadosBlacklist?: number;
  descartadosSinKeywords?: number;
  enviadosAlPipeline?: number;
  duracionMs?: number;
}> {
  return backendFetch(`/api/scrapers/correr/${encodeURIComponent(portal)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
