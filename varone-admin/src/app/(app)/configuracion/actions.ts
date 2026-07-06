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

import {
  probarScraperCustom as backendProbarScraper,
  crearPortalCustom as backendCrearPortal,
  togglePortalCustom as backendTogglePortal,
  eliminarPortalCustom as backendEliminarPortal,
  type ProbarScraperResult,
} from '@/lib/backend';

// ─── Sprint portales-custom (2026-07-06) ──────────────────────────────

export async function probarScraperCustomAction(cfg: {
  url: string;
  cardSelector?: string;
  linkSelector?: string;
  titleSelector?: string;
}): Promise<ProbarScraperResult> {
  const session = await getSession();
  if (!session) return { ok: false, cardsMatcheadas: 0, notasExtraidas: 0, primeras: [], error: 'No autenticado' };
  return backendProbarScraper(cfg);
}

export async function crearPortalCustomAction(cfg: {
  nombre: string;
  url: string;
  cardSelector?: string;
  linkSelector?: string;
  titleSelector?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };
  const r = await backendCrearPortal({ ...cfg, editorPor: session.user });
  if (r.ok) revalidatePath('/configuracion');
  return { ok: r.ok, error: r.error };
}

export async function togglePortalCustomAction(id: number, activo: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };
  const r = await backendTogglePortal(id, activo);
  if (r.ok) revalidatePath('/configuracion');
  return r;
}

export async function eliminarPortalCustomAction(id: number): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'No autenticado' };
  const r = await backendEliminarPortal(id);
  if (r.ok) revalidatePath('/configuracion');
  return r;
}
