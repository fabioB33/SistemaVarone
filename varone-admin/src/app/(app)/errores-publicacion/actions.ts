'use server';

/**
 * Sprint hardening 13-mejoras (2026-06-27) — Server Actions de errores publicacion.
 *
 * `fallo_publicacion` = reportes aprobados que el framer-publisher no pudo
 * postear (sitio caído, selector cambió, sesión vencida, etc).
 *
 * Acciones:
 * - reintentarPublicacionAction: resetea intentos + dispara enviarAFramer.
 * - descartarFalloAction: si Varone decide no insistir, lo manda a descartado.
 */

import { revalidatePath } from 'next/cache';
import { reintentarUnReporte, descartarReporte } from '@/lib/backend';
import { getSession } from '@/lib/auth';

export async function reintentarPublicacionAction(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const r = await reintentarUnReporte(id);
  if (r.ok) {
    revalidatePath('/errores-publicacion');
    revalidatePath('/aprobacion');
  }
  return r;
}

export async function descartarFalloAction(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const r = await descartarReporte(id, session.user);
  if (r.ok) {
    revalidatePath('/errores-publicacion');
    revalidatePath('/aprobacion');
  }
  return r;
}
