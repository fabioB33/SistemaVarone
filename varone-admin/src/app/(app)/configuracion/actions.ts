'use server';

/**
 * Sprint admin-config (2026-06-30) — Server Actions del panel configuración.
 */

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { guardarPortalesActivos, guardarWaGroupName } from '@/lib/backend';

export async function guardarPortalesActivosAction(
  activos: Record<string, boolean>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const r = await guardarPortalesActivos(activos, session.user);
  if (r.ok) revalidatePath('/configuracion');
  return r;
}

export async function guardarWaGroupNameAction(
  groupName: string,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };

  const r = await guardarWaGroupName(groupName.trim(), session.user);
  if (r.ok) revalidatePath('/configuracion');
  return r;
}
