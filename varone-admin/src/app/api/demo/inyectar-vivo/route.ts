import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/**
 * Sprint sugerencias-extras (2026-06-30): proxy autenticado al endpoint demo.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });

  try {
    const url = `${process.env.NEXT_PUBLIC_SISTEMA_VARONE_URL || 'http://127.0.0.1:3000'}/api/demo/inyectar-vivo`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const backendToken = process.env.BACKEND_API_TOKEN;
    if (backendToken) headers['X-Backend-Token'] = backendToken;

    const r = await fetch(url, { method: 'POST', headers, body: '{}', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j as Record<string, unknown>, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Error' },
      { status: 503 },
    );
  }
}
