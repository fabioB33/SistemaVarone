'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import {
  analizarUrlBackend,
  aprobarReporte,
  descartarReporte,
  despublicarReporte,
  editarReporteBackend,
  reintentarUnReporte,
  type AnalizarUrlResult,
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
