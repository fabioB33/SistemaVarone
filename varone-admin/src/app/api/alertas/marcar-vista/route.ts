import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { marcarAlertaVista } from '@/lib/backend';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = parseInt(String(body?.id ?? ''), 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: 'id inválido' }, { status: 400 });
  }

  const result = await marcarAlertaVista(id);
  return NextResponse.json(result);
}
