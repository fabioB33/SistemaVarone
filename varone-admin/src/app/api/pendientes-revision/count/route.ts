import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { contarPendientesRevision } from '@/lib/backend';

/**
 * Sprint pivot-framer-form (2026-06-26) — Proxy autenticado al contador
 * de pendientes_revision del backend. Usado por el badge del topbar.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const count = await contarPendientesRevision();
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0, backendDown: true });
  }
}
