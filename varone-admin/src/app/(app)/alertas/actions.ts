'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { marcarAlertaVista, marcarTodasAlertasVistas } from '@/lib/backend';

async function requireUser(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error('No autenticado');
  return session.user;
}

export async function marcarVistaAction(id: number) {
  await requireUser();
  const result = await marcarAlertaVista(id);
  revalidatePath('/alertas');
  return result;
}

export async function marcarTodasAction() {
  await requireUser();
  const result = await marcarTodasAlertasVistas();
  revalidatePath('/alertas');
  return result;
}
