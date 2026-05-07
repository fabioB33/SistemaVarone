import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listarAlertas } from '@/lib/backend';

/**
 * Proxy autenticado al listado de alertas del backend.
 * Acepta query params: soloSinLeer, tipo, limit.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const soloSinLeer = searchParams.get('soloSinLeer') === 'true';
  const tipo = searchParams.get('tipo') || undefined;
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  try {
    const items = await listarAlertas({ soloSinLeer, tipo, limit });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ items: [], error: e instanceof Error ? e.message : String(e) });
  }
}
