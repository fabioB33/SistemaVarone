import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const url = `${process.env.NEXT_PUBLIC_SISTEMA_VARONE_URL || 'http://127.0.0.1:3000'}/api/dashboard/counters`;
    const headers: Record<string, string> = {};
    const t = process.env.BACKEND_API_TOKEN;
    if (t) headers['X-Backend-Token'] = t;
    const r = await fetch(url, { headers, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j as Record<string, unknown>, { status: r.status });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
