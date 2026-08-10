import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listarGruposWa } from '@/lib/backend';

/**
 * Proxy autenticado a /api/wa/grupos del backend.
 *
 * El browser no tiene `BACKEND_API_TOKEN` — lo tiene este server, y solo lo usa
 * si la cookie de sesión es válida. Mismo patrón que /api/wa/status.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  return NextResponse.json(await listarGruposWa());
}
