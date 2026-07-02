'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import {
  aprobarReporte,
  descartarReporte,
  despublicarReporte,
  editarReporteBackend,
  reintentarUnReporte,
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
