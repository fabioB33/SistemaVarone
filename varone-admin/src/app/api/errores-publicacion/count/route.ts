import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/**
 * Sprint hardening 13-mejoras (2026-06-27) — Proxy autenticado al contador
 * de fallos_publicacion del backend. Usado por el badge del topbar.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const url = `${process.env.NEXT_PUBLIC_SISTEMA_VARONE_URL || 'http://127.0.0.1:3000'}/api/aprobacion/contar-fallos-publicacion`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const backendToken = process.env.BACKEND_API_TOKEN;
    if (backendToken) headers['X-Backend-Token'] = backendToken;

    const r = await fetch(url, { headers, cache: 'no-store' });
    if (!r.ok) return NextResponse.json({ count: 0, backendDown: true });
    const j = (await r.json()) as { count?: number };
    return NextResponse.json({ count: j.count ?? 0 });
  } catch {
    return NextResponse.json({ count: 0, backendDown: true });
  }
}
