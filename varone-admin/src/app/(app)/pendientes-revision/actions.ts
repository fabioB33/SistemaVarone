'use server';

/**
 * Sprint pivot-framer-form (2026-06-26) — Server Actions del panel
 * de pendientes_revision.
 *
 * Usa el endpoint /api/aprobacion/editar del backend que ya recalcula
 * camposFaltantes + transiciona automáticamente a 'pendiente' si Varone
 * completa todos los dropdowns.
 */

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import {
  editarReporteBackend,
  descartarReporte,
  type ReporteEditableFields,
} from '@/lib/backend';

async function requireUser(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error('No autenticado');
  return session.user;
}

export async function completarCamposFramerAction(
  id: number,
  cambios: ReporteEditableFields,
) {
  const user = await requireUser();
  const result = await editarReporteBackend(id, cambios, user);
  revalidatePath('/pendientes-revision');
  revalidatePath('/aprobacion');
  return result;
}

export async function descartarPendienteRevisionAction(id: number) {
  const user = await requireUser();
  const result = await descartarReporte(id, user);
  revalidatePath('/pendientes-revision');
  revalidatePath('/aprobacion');
  return result;
}
