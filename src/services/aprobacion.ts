/**
 * Servicio de aprobación humana de reportes.
 *
 * Flujo:
 *  1. Pipeline crea reporte con estado='pendiente'.
 *  2. Varone (desde dashboard) llama a `aprobar(id)` → envía a Framer (draft).
 *  3. Cron diario llama a `publicarSitio()` para hacer público.
 *
 * Estados:
 *   pendiente   recién creado, esperando decisión humana
 *   aprobado    Varone aprobó; ya está en Framer (draft) — esperando publish
 *   publicado   item ya está en Framer y el sitio fue re-publicado
 *   descartado  Varone descartó; nunca se envía a Framer
 */

import prisma from './prisma';
import logger from './logger';
import { enviarAFramer } from './framer';
import { registrarAccion, type AuditOrigen } from './audit';
import { ReporteIncidente } from '../types';

// Origen por defecto cuando se invoca aprobar/descartar/editar sin contexto explicito.
// El backend pasa el origen real cuando lo conoce (panel, quick-action, etc.).
type ActorContext = { origen?: AuditOrigen; ip?: string | null; userAgent?: string | null };

export interface ReportePublic {
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
  aprobadoEn: Date | null;
  creadoEn: Date;
}

export async function listarPendientes(limit = 50): Promise<ReportePublic[]> {
  const rows = await prisma.reporte.findMany({
    where: { estado: 'pendiente' },
    orderBy: { creadoEn: 'desc' },
    take: limit,
  });
  return rows as unknown as ReportePublic[];
}

export async function listarPorEstado(
  estado: 'pendiente' | 'aprobado' | 'publicado' | 'descartado',
  limit = 50,
): Promise<ReportePublic[]> {
  const rows = await prisma.reporte.findMany({
    where: { estado },
    orderBy: { creadoEn: 'desc' },
    take: limit,
  });
  return rows as unknown as ReportePublic[];
}

export async function aprobar(
  id: number,
  aprobadoPor: string,
  ctx: ActorContext = {},
): Promise<{ ok: true; framerItemId: string; framerSlug: string } | { ok: false; error: string }> {
  const origen = ctx.origen ?? 'panel';
  const r = await prisma.reporte.findUnique({ where: { id } });
  if (!r) {
    void registrarAccion({
      evento: 'aprobar.fail.not-found', actor: aprobadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { ok: false, error: 'Reporte no encontrado' };
  }
  if (r.estado !== 'pendiente') {
    void registrarAccion({
      evento: 'aprobar.fail.wrong-state', actor: aprobadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
      meta: { estadoActual: r.estado },
    });
    return { ok: false, error: `Reporte ya está en estado ${r.estado}` };
  }

  const reporte: ReporteIncidente = {
    fecha: r.fecha,
    hora: r.hora ?? 'desconocida',
    ubicacion: r.ubicacion,
    ruta: r.ruta,
    tipoIncidente: r.tipoIncidente,
    gravedad: r.gravedad ?? undefined,
    descripcion: r.descripcion,
    vehiculo: r.vehiculo ?? undefined,
    patente: r.patente ?? undefined,
    victimas: r.victimas ?? undefined,
    detenidos: r.detenidos ?? undefined,
    fuente: r.fuente as 'whatsapp' | 'scraping',
    urlNoticia: r.urlNoticia ?? undefined,
    portalOrigen: r.portalOrigen ?? undefined,
    textoOriginal: r.textoOriginal,
  };

  // No publicamos el sitio acá: queda en draft hasta el cron diario.
  const result = await enviarAFramer(reporte, id, { publishSite: false });

  if (!result) {
    // Marcamos como aprobado igual; el cron de reintentos se encargará
    await prisma.reporte.update({
      where: { id },
      data: {
        estado: 'aprobado',
        aprobadoPor,
        aprobadoEn: new Date(),
      },
    });
    void registrarAccion({
      evento: 'aprobar.partial.framer-pending', actor: aprobadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { ok: false, error: 'Aprobado pero falló el envío a Framer (se reintentará automáticamente)' };
  }

  await prisma.reporte.update({
    where: { id },
    data: {
      estado: 'aprobado',
      aprobadoPor,
      aprobadoEn: new Date(),
      framerItemId: result.itemId,
      framerSlug: result.slug,
    },
  });

  logger.info(`[Aprobación] Reporte #${id} aprobado por ${aprobadoPor} → Framer item ${result.itemId}`);
  void registrarAccion({
    evento: 'aprobar.success', actor: aprobadoPor, origen, reporteId: id,
    ip: ctx.ip, userAgent: ctx.userAgent,
    meta: { framerItemId: result.itemId, framerSlug: result.slug },
  });
  return { ok: true, framerItemId: result.itemId, framerSlug: result.slug };
}

export async function descartar(
  id: number,
  descartadoPor: string,
  ctx: ActorContext = {},
): Promise<{ ok: boolean; error?: string }> {
  const origen = ctx.origen ?? 'panel';
  const r = await prisma.reporte.findUnique({ where: { id } });
  if (!r) {
    void registrarAccion({
      evento: 'descartar.fail.not-found', actor: descartadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { ok: false, error: 'Reporte no encontrado' };
  }
  if (r.estado !== 'pendiente') {
    void registrarAccion({
      evento: 'descartar.fail.wrong-state', actor: descartadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
      meta: { estadoActual: r.estado },
    });
    return { ok: false, error: `Reporte ya está en estado ${r.estado}` };
  }
  await prisma.reporte.update({
    where: { id },
    data: {
      estado: 'descartado',
      aprobadoPor: descartadoPor,
      aprobadoEn: new Date(),
    },
  });
  logger.info(`[Aprobación] Reporte #${id} descartado por ${descartadoPor}`);
  void registrarAccion({
    evento: 'descartar.success', actor: descartadoPor, origen, reporteId: id,
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { ok: true };
}

export interface EditarPendienteInput {
  ubicacion?: string;
  ruta?: string;
  tipoIncidente?: string;
  gravedad?: string | null;
  descripcion?: string;
  fecha?: string;
  hora?: string | null;
  vehiculo?: string | null;
  patente?: string | null;
  victimas?: string | null;
  detenidos?: string | null;
  urlNoticia?: string | null;
  ogImageUrl?: string | null;
}

const EDITABLE_KEYS: readonly (keyof EditarPendienteInput)[] = [
  'ubicacion',
  'ruta',
  'tipoIncidente',
  'gravedad',
  'descripcion',
  'fecha',
  'hora',
  'vehiculo',
  'patente',
  'victimas',
  'detenidos',
  'urlNoticia',
  'ogImageUrl',
];

const STRING_LIMITS: Partial<Record<keyof EditarPendienteInput, number>> = {
  ubicacion: 200,
  ruta: 200,
  tipoIncidente: 80,
  gravedad: 20,
  descripcion: 2000,
  fecha: 10,
  hora: 30,
  vehiculo: 200,
  patente: 30,
  victimas: 500,
  detenidos: 200,
  urlNoticia: 2048,
  ogImageUrl: 2048,
};

function normalize(
  raw: EditarPendienteInput,
): { ok: true; data: Record<string, string | null> } | { ok: false; error: string } {
  const data: Record<string, string | null> = {};
  for (const key of EDITABLE_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v === null || v === undefined) {
      data[key] = null;
      continue;
    }
    if (typeof v !== 'string') {
      return { ok: false, error: `Campo ${key} debe ser string` };
    }
    const trimmed = v.trim();
    const limit = STRING_LIMITS[key];
    if (limit && trimmed.length > limit) {
      return { ok: false, error: `Campo ${key} excede ${limit} caracteres` };
    }
    data[key] = trimmed === '' ? null : trimmed;
  }
  if (typeof data.fecha === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
    return { ok: false, error: 'fecha debe tener formato YYYY-MM-DD' };
  }
  if (typeof data.urlNoticia === 'string' && !/^https?:\/\//.test(data.urlNoticia)) {
    return { ok: false, error: 'urlNoticia debe empezar con http(s)://' };
  }
  if (typeof data.ogImageUrl === 'string' && !/^https?:\/\//.test(data.ogImageUrl)) {
    return { ok: false, error: 'ogImageUrl debe empezar con http(s)://' };
  }
  // Campos requeridos no se pueden vaciar
  for (const required of ['ubicacion', 'ruta', 'tipoIncidente', 'descripcion', 'fecha'] as const) {
    if (data[required] === null) {
      return { ok: false, error: `Campo ${required} no puede quedar vacío` };
    }
  }
  return { ok: true, data };
}

/**
 * Edita un reporte pendiente antes de aprobarlo.
 * Solo se permite cuando estado='pendiente' — una vez aprobado, los datos
 * que viajan a Framer no deberían modificarse desde acá (habría que crear
 * un endpoint de "re-publicar" si hace falta).
 */
export async function editarPendiente(
  id: number,
  input: EditarPendienteInput,
  editorPor: string,
  ctx: ActorContext = {},
): Promise<{ ok: true; reporte: ReportePublic } | { ok: false; error: string }> {
  const origen = ctx.origen ?? 'panel';
  const r = await prisma.reporte.findUnique({ where: { id } });
  if (!r) {
    void registrarAccion({
      evento: 'editar.fail.not-found', actor: editorPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { ok: false, error: 'Reporte no encontrado' };
  }
  if (r.estado !== 'pendiente') {
    void registrarAccion({
      evento: 'editar.fail.wrong-state', actor: editorPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
      meta: { estadoActual: r.estado },
    });
    return { ok: false, error: `Solo se pueden editar reportes pendientes (estado actual: ${r.estado})` };
  }
  const norm = normalize(input);
  if (!norm.ok) {
    void registrarAccion({
      evento: 'editar.fail.validation', actor: editorPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
      meta: { error: norm.error },
    });
    return norm;
  }
  if (Object.keys(norm.data).length === 0) {
    return { ok: false, error: 'Sin cambios' };
  }

  // Snapshot antes/después solo de los campos modificados, para audit.
  const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
  for (const k of Object.keys(norm.data)) {
    cambios[k] = {
      antes: (r as Record<string, unknown>)[k] ?? null,
      despues: norm.data[k],
    };
  }

  const updated = await prisma.reporte.update({
    where: { id },
    data: norm.data,
  });

  logger.info(
    `[Aprobación] Reporte #${id} editado por ${editorPor} (${Object.keys(norm.data).length} campos)`,
  );
  void registrarAccion({
    evento: 'editar.success', actor: editorPor, origen, reporteId: id,
    ip: ctx.ip, userAgent: ctx.userAgent,
    meta: { campos: Object.keys(norm.data), cambios },
  });
  return { ok: true, reporte: updated as unknown as ReportePublic };
}

/**
 * Marca como publicado todos los reportes en estado 'aprobado' que ya tengan
 * framerItemId. Se llama desde el cron luego de publish exitoso.
 */
export async function marcarPublicadosTrasPublish(): Promise<number> {
  const result = await prisma.reporte.updateMany({
    where: {
      estado: 'aprobado',
      framerItemId: { not: null },
    },
    data: { estado: 'publicado' },
  });
  return result.count;
}
