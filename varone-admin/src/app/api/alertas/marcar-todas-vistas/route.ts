import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { marcarTodasAlertasVistas } from '@/lib/backend';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const result = await marcarTodasAlertasVistas();
  return NextResponse.json(result);
}
