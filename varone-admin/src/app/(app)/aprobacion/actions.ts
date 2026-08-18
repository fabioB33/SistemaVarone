'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import {
  analizarUrlBackend,
  analizarTextoBackend,
  reportarManualBackend,
  aprobarReporte,
  descartarReporte,
  despublicarReporte,
  editarReporteBackend,
  reintentarUnReporte,
  type AnalizarUrlResult,
  type ReportarManualResult,
  type ReporteEditableFields,
} from '@/lib/backend';

async function requireUser(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error('No autenticado');
  return session.user;
}

export async function aprobarAction(id: number) {
  const user = await requireUser();
  const result = await aprobarReporte(id, user);
  revalidatePath('/aprobacion');
  return result;
}

export async function descartarAction(id: number) {
  const user = await requireUser();
  const result = await descartarReporte(id, user);
  revalidatePath('/aprobacion');
  return result;
}

export async function despublicarAction(id: number) {
  const user = await requireUser();
  const result = await despublicarReporte(id, user);
  revalidatePath('/aprobacion');
  return result;
}

export async function editarAction(id: number, cambios: ReporteEditableFields) {
  const user = await requireUser();
  const result = await editarReporteBackend(id, cambios, user);
  revalidatePath('/aprobacion');
  return result;
}

/**
 * Sprint flow-unificado-aprobacion (2026-06-28): completar dropdowns
 * faltantes inline desde la card de /aprobacion.
 *
 * El backend recalcula `camposFaltantes` post-edit. Si todos los
 * dropdowns obligatorios quedan completos, el array queda vacío y el
 * botón "Aprobar" se habilita en el siguiente render.
 *
 * Misma firma que la action vieja de /pendientes-revision (que se elimina
 * en este sprint) para preservar el behavior.
 */
export async function completarCamposFramerAction(
  id: number,
  cambios: ReporteEditableFields,
) {
  const user = await requireUser();
  const result = await editarReporteBackend(id, cambios, user);
  revalidatePath('/aprobacion');
  return result;
}

// Sprint mejoras-flujo (2026-06-30): publicarSitioAction eliminada.

/**
 * Sprint mejoras-flujo (2026-06-30): movido desde /errores-publicacion/actions.ts
 * (esa página ya no existe — los errores viven en /aprobacion?estado=fallo_publicacion).
 */
export async function reintentarPublicacionAction(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const r = await reintentarUnReporte(id);
  if (r.ok) revalidatePath('/aprobacion');
  return r;
}

/**
 * Sprint 2026-07-07 — Análisis manual de URL.
 *
 * Contexto: el scraper cron lee solo la portada del portal, así que notas
 * que caen fuera del top 20 (por antigüedad o por publicarse entre corridas)
 * se pierden. Este flow permite a Varone pegar una URL de una nota puntual
 * y forzar que pase por todo el pipeline (fetch + prefiltro + IA + dedup).
 *
 * Reutiliza `analizarUrlBackend` que golpea `POST /api/analizar-url`.
 * revalidatePath('/aprobacion') refresca la lista para que Varone vea la
 * nueva card si pasó IA + prefiltro.
 */
export async function analizarUrlAction(url: string): Promise<AnalizarUrlResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'URL requerida' };

  const r = await analizarUrlBackend(trimmed);
  if (r.ok) revalidatePath('/aprobacion');
  return r;
}

/**
 * Sprint 2026-08-13 — Análisis manual de texto libre.
 *
 * Contraparte de analizarUrlAction para mensajes del grupo de WhatsApp que
 * no traen un link (el usuario escribió el relato a mano). Mismo pipeline
 * (fetch si detecta URL embebida + prefiltro + IA + dedup), solo cambia el
 * shape del input.
 */
export async function analizarTextoAction(texto: string): Promise<AnalizarUrlResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const trimmed = texto.trim();
  if (trimmed.length < 15) return { ok: false, error: 'El texto debe tener al menos 15 caracteres' };

  const r = await analizarTextoBackend(trimmed);
  if (r.ok) revalidatePath('/aprobacion');
  return r;
}

/**
 * Sprint 2026-08-13 — Carga manual forzada, sin pasar por la IA.
 *
 * Motivación: Varone reportó que 2 noticias del grupo de WhatsApp no fueron
 * procesadas por el bot y nadie se enteró hasta que las vio pasar en el
 * grupo. Si reintentar vía analizarTextoAction/analizarUrlAction vuelve a
 * descartar la noticia (mismo motivo que la primera vez — rate-limit, IA
 * decide "no relevante", etc.), esta acción crea el reporte directo en
 * 'pendiente' sin invocar a la IA. Varone completa a mano los dropdowns
 * faltantes desde la card de /aprobacion (mismo mecanismo ya existente).
 */
export async function reportarManualAction(
  texto: string,
  url?: string,
): Promise<ReportarManualResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const trimmed = texto.trim();
  if (trimmed.length < 15) return { ok: false, error: 'El texto debe tener al menos 15 caracteres' };

  const r = await reportarManualBackend(trimmed, url?.trim() || undefined);
  if (r.ok) revalidatePath('/aprobacion');
  return r;
}
