import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { contarAlertasSinLeer } from '@/lib/backend';

/**
 * Proxy autenticado al contador de alertas sin leer del backend.
 * Endpoint liviano usado por el badge del topbar (poll cada 30s).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const count = await contarAlertasSinLeer();
    return NextResponse.json({ count });
  } catch {
    // Si backend está caído, devolver 0 sin romper el badge.
    return NextResponse.json({ count: 0, backendDown: true });
  }
}
