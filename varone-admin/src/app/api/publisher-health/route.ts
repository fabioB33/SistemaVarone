import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/**
 * Sprint hardening 13-mejoras (2026-06-27) — Proxy autenticado al healthcheck
 * del framer-publisher. Sin esto, el frontend tendría que conocer el token del
 * publisher. Usado por el badge del topbar.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const url = `${process.env.NEXT_PUBLIC_SISTEMA_VARONE_URL || 'http://127.0.0.1:3000'}/api/framer/health`;
    const headers: Record<string, string> = {};
    const backendToken = process.env.BACKEND_API_TOKEN;
    if (backendToken) headers['X-Backend-Token'] = backendToken;

    const r = await fetch(url, { headers, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j as Record<string, unknown>, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, publisherStatus: 'unreachable', error: e instanceof Error ? e.message : 'desconocido' },
      { status: 503 },
    );
  }
}
