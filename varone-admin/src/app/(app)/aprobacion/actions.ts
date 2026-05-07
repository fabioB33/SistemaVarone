'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import {
  aprobarReporte,
  descartarReporte,
  despublicarReporte,
  editarReporteBackend,
  publicarSitioFramer,
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

export async function publicarSitioAction() {
  await requireUser();
  const result = await publicarSitioFramer();
  revalidatePath('/aprobacion');
  return result;
}
