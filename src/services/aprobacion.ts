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

  // Sprint pivot-framer-form (2026-06-26) — 10 campos del formulario público
  // + lista de campos donde la IA no pudo elegir y Varone tiene que completar.
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
}

/** Estados válidos del Reporte. */
export type EstadoReporte =
  | 'pendiente'
  | 'pendiente_revision'
  | 'aprobado'
  | 'publicado'
  | 'descartado'
  | 'fallo_publicacion';

export async function listarPendientes(limit = 50): Promise<ReportePublic[]> {
  const rows = await prisma.reporte.findMany({
    where: { estado: 'pendiente' },
    orderBy: { creadoEn: 'desc' },
    take: limit,
  });
  return rows as unknown as ReportePublic[];
}

export async function listarPorEstado(
  estado: EstadoReporte,
  limit = 50,
): Promise<ReportePublic[]> {
  const rows = await prisma.reporte.findMany({
    where: { estado },
    orderBy: { creadoEn: 'desc' },
    take: limit,
  });
  return rows as unknown as ReportePublic[];
}

/**
 * Sprint pivot-framer-form (2026-06-26) — cuenta reportes que requieren
 * acción humana de Varone para completar dropdowns faltantes.
 *
 * Usado por el badge del panel admin para alertar visualmente.
 */
export async function contarPendientesRevision(): Promise<number> {
  return prisma.reporte.count({ where: { estado: 'pendiente_revision' } });
}

export async function aprobar(
  id: number,
  aprobadoPor: string,
  ctx: ActorContext = {},
): Promise<{ ok: boolean; error?: string }> {
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

  // Sprint flow-unificado-aprobacion (2026-06-28): bloqueo defensivo en
  // backend. El frontend deshabilita el botón "Aprobar" cuando hay
  // faltantes, pero un actor (o script) podría pegar directo al endpoint.
  // Cubrimos servidor-side para no publicar reportes incompletos en el
  // formulario público.
  if (r.camposFaltantes && r.camposFaltantes.length > 0) {
    void registrarAccion({
      evento: 'aprobar.fail.campos-faltantes', actor: aprobadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
      meta: { camposFaltantes: r.camposFaltantes },
    });
    return {
      ok: false,
      error: `No se puede aprobar: faltan ${r.camposFaltantes.length} dropdown(s) del formulario público (${r.camposFaltantes.join(', ')}). Completá los campos en amber antes de aprobar.`,
    };
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
    fuente: r.fuente as 'whatsapp',
    urlNoticia: r.urlNoticia ?? undefined,
    portalOrigen: r.portalOrigen ?? undefined,
    textoOriginal: r.textoOriginal,
  };

  // Sprint pivot-framer-form (2026-06-26): la firma de enviarAFramer cambió.
  // Ahora solo necesita el reporteId (lee todo de la DB) y retorna {ok, error}.
  // Si el reporte tiene camposFaltantes, retorna error sin publicar.
  // Primero marcamos como aprobado (registro del acto de Varone) y después
  // intentamos publicar. Si el publish falla, queda en estado intermedio que
  // el cron retry procesa.
  await prisma.reporte.update({
    where: { id },
    data: {
      estado: 'aprobado',
      aprobadoPor,
      aprobadoEn: new Date(),
    },
  });

  const result = await enviarAFramer(id);

  if (!result.ok) {
    void registrarAccion({
      evento: 'aprobar.partial.framer-pending',
      actor: aprobadoPor,
      origen,
      reporteId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      meta: { error: result.error },
    });
    return {
      ok: false,
      error: `Aprobado pero falló publicación en form Framer: ${result.error}. Cron retry lo procesará.`,
    };
  }

  // enviarAFramer ya actualizó estado a 'publicado' + framerItemId.
  logger.info(`[Aprobación] Reporte #${id} aprobado por ${aprobadoPor} y publicado en form.`);
  void registrarAccion({
    evento: 'aprobar.success',
    actor: aprobadoPor,
    origen,
    reporteId: id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
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

  // Sprint pivot-framer-form (2026-06-26) — 10 campos del formulario público
  // editables desde el panel cuando Varone completa los `camposFaltantes`.
  provincia?: string | null;
  tipoIncidenteFramer?: string | null;
  fuerzaInterviniente?: string | null;
  tipoVehiculo?: string | null;
  cargaTransportada?: string | null;
  modusOperandi?: string | null;
  huboViolencia?: string | null;
  tipoVehiculoInvolucrado?: string | null;
  cantidadVehiculosInvolucrados?: string | null;
  cantidadPersonasInvolucradas?: string | null;
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
  // Sprint pivot-framer-form (2026-06-26): 10 campos del formulario público.
  'provincia',
  'tipoIncidenteFramer',
  'fuerzaInterviniente',
  'tipoVehiculo',
  'cargaTransportada',
  'modusOperandi',
  'huboViolencia',
  'tipoVehiculoInvolucrado',
  'cantidadVehiculosInvolucrados',
  'cantidadPersonasInvolucradas',
] as const;

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
  // Sprint pivot-framer-form: dropdowns Framer (strings cortos canonical).
  provincia: 60,
  tipoIncidenteFramer: 80,
  fuerzaInterviniente: 80,
  tipoVehiculo: 60,
  cargaTransportada: 60,
  modusOperandi: 40,
  huboViolencia: 4,
  tipoVehiculoInvolucrado: 20,
  cantidadVehiculosInvolucrados: 10,
  cantidadPersonasInvolucradas: 10,
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
 *
 * Sprint pivot-framer-form (2026-06-26) + flow-unificado-aprobacion
 * (2026-06-28): SOLO 'pendiente' editable. Antes había un estado dedicado
 * 'pendiente_revision' para reportes con dropdowns ambiguos, ahora todos
 * arrancan en 'pendiente' y los faltantes se editan inline en la card de
 * /aprobacion. Si Varone completa todos los dropdowns, `camposFaltantes`
 * queda vacío y el botón "Aprobar" se habilita.
 *
 * Estado editable: SOLO 'pendiente'. Reportes legacy en 'pendiente_revision'
 * son migrados a 'pendiente' por la migration `20260628_*` al deploy.
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
  // Sprint flow-unificado-aprobacion (2026-06-28): SOLO 'pendiente' editable.
  // El estado 'pendiente_revision' quedó obsoleto. Reportes legacy migrados
  // por SQL al deploy. Lo dejamos en la lista por backwards compat por si
  // queda alguno en la DB de prod antes de aplicar la migration.
  const estadosEditables = ['pendiente', 'pendiente_revision'];
  if (!estadosEditables.includes(r.estado)) {
    void registrarAccion({
      evento: 'editar.fail.wrong-state', actor: editorPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
      meta: { estadoActual: r.estado },
    });
    return { ok: false, error: `Solo se pueden editar reportes pendiente o pendiente_revision (estado actual: ${r.estado})` };
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

  // Sprint pivot-framer-form: recalcular camposFaltantes + auto-transición
  // del estado pendiente_revision → pendiente cuando se completa todo.
  //
  // Mergeamos los valores existentes (r.*) con los cambios (norm.data) para
  // calcular el estado FINAL de los 10 campos Framer.
  const mergedFramer = {
    provincia: 'provincia' in norm.data ? norm.data.provincia : r.provincia,
    tipoIncidenteFramer: 'tipoIncidenteFramer' in norm.data ? norm.data.tipoIncidenteFramer : r.tipoIncidenteFramer,
    fuerzaInterviniente: 'fuerzaInterviniente' in norm.data ? norm.data.fuerzaInterviniente : r.fuerzaInterviniente,
    tipoVehiculo: 'tipoVehiculo' in norm.data ? norm.data.tipoVehiculo : r.tipoVehiculo,
    cargaTransportada: 'cargaTransportada' in norm.data ? norm.data.cargaTransportada : r.cargaTransportada,
    modusOperandi: 'modusOperandi' in norm.data ? norm.data.modusOperandi : r.modusOperandi,
    huboViolencia: 'huboViolencia' in norm.data ? norm.data.huboViolencia : r.huboViolencia,
    tipoVehiculoInvolucrado: 'tipoVehiculoInvolucrado' in norm.data ? norm.data.tipoVehiculoInvolucrado : r.tipoVehiculoInvolucrado,
    cantidadVehiculosInvolucrados: 'cantidadVehiculosInvolucrados' in norm.data ? norm.data.cantidadVehiculosInvolucrados : r.cantidadVehiculosInvolucrados,
    cantidadPersonasInvolucradas: 'cantidadPersonasInvolucradas' in norm.data ? norm.data.cantidadPersonasInvolucradas : r.cantidadPersonasInvolucradas,
  };

  // Aplicar el matcher para validar que los valores nuevos (si los hay) sean
  // canonical. Si Varone tipeó algo no-canonical desde el panel, se queda
  // como faltante.
  const { resolverCamposFramer } = await import('./enum-matcher');
  const resolved = resolverCamposFramer(mergedFramer);
  const nuevoEstado =
    r.estado === 'pendiente_revision' && resolved.camposFaltantes.length === 0
      ? 'pendiente'
      : r.estado;

  const dataFinal: Record<string, unknown> = {
    ...norm.data,
    camposFaltantes: resolved.camposFaltantes,
  };
  if (nuevoEstado !== r.estado) {
    dataFinal.estado = nuevoEstado;
  }

  const updated = await prisma.reporte.update({
    where: { id },
    data: dataFinal,
  });

  logger.info(
    `[Aprobación] Reporte #${id} editado por ${editorPor} (${Object.keys(norm.data).length} campos, faltantes=${resolved.camposFaltantes.length}, estado=${nuevoEstado})`,
  );
  void registrarAccion({
    evento: 'editar.success', actor: editorPor, origen, reporteId: id,
    ip: ctx.ip, userAgent: ctx.userAgent,
    meta: {
      campos: Object.keys(norm.data),
      cambios,
      camposFaltantesPost: resolved.camposFaltantes,
      estadoPre: r.estado,
      estadoPost: nuevoEstado,
    },
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

/**
 * Auto-aprobación por la IA: el pipeline llamó a IA, fue marcado relevante,
 * el envío a Framer ya se hizo con éxito (publishSite=false → item draft).
 * Acá solo persistimos en DB el estado=aprobado + audit log con actor='ai-auto'.
 *
 * El reporte ya fue creado por registrarReporte() antes con estado='pendiente'
 * (default del schema). Esta función transiciona pendiente → aprobado de
 * forma atómica con la metadata correcta.
 *
 * Si el envío a Framer falló, NO se llama esta función — el reporte queda
 * en 'pendiente' y el cron reintentarFramerPendientes() lo levanta después.
 */
export async function aprobarPorIA(
  id: number,
  framerItemId: string,
  framerSlug: string,
): Promise<void> {
  await prisma.reporte.update({
    where: { id },
    data: {
      estado: 'aprobado',
      aprobadoPor: 'ai-auto',
      aprobadoEn: new Date(),
      framerItemId,
      framerSlug,
    },
  });
  void registrarAccion({
    evento: 'aprobar.ai-auto',
    actor: 'ai-auto',
    origen: 'system',
    reporteId: id,
    meta: { framerItemId, framerSlug },
  });
}

/**
 * Despublica un reporte ya publicado (o aprobado) desde el panel admin.
 * Es el bypass humano para corregir errores de la IA.
 *
 * Pasos:
 *  1. Marca el reporte como 'descartado' en DB.
 *  2. Borra el item de la collection en Framer (vía publisher).
 *  3. Re-publica el sitio para que el item desaparezca del público.
 *
 * Si el paso 2 o 3 falla, el reporte igual queda 'descartado' en DB y
 * se notifica al usuario que tiene que verificar manualmente en Framer.
 */
export async function despublicar(
  id: number,
  despublicadoPor: string,
  ctx: ActorContext = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const origen = ctx.origen ?? 'panel';
  const r = await prisma.reporte.findUnique({ where: { id } });
  if (!r) {
    void registrarAccion({
      evento: 'despublicar.fail.not-found', actor: despublicadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { ok: false, error: 'Reporte no encontrado' };
  }
  if (r.estado !== 'aprobado' && r.estado !== 'publicado') {
    void registrarAccion({
      evento: 'despublicar.fail.wrong-state', actor: despublicadoPor, origen, reporteId: id,
      ip: ctx.ip, userAgent: ctx.userAgent,
      meta: { estadoActual: r.estado },
    });
    return { ok: false, error: `Solo se pueden despublicar reportes aprobados o publicados (estado actual: ${r.estado})` };
  }

  // 1. Marcar como descartado en DB primero (lo más crítico — el sitio aún tiene el item
  // pero al menos en nuestro registro queda fuera).
  await prisma.reporte.update({
    where: { id },
    data: { estado: 'descartado', aprobadoPor: despublicadoPor, aprobadoEn: new Date() },
  });

  // 2. Sprint pivot-framer-form: el form público no expone delete.
  // Si Varone quiere que el reporte deje de aparecer en el sitio, debe
  // contactar al admin del sitio. Acá solo lo marcamos descartado en DB.
  logger.warn(
    `[Aprobación] Reporte #${id} descartado por ${despublicadoPor}. ` +
    `Sprint pivot-framer-form: NO se puede despublicar del sitio automáticamente. ` +
    `Contactar admin de pirateriadecamiones.com.ar si quedó publicado allá.`,
  );
  void registrarAccion({
    evento: 'despublicar.success',
    actor: despublicadoPor,
    origen,
    reporteId: id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    meta: r.framerItemId ? { warningSitioSinDelete: true, urlFinal: r.framerItemId } : null,
  });
  return { ok: true };
}
