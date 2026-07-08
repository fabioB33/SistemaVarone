/**
 * Sprint mapa (2026-06-27) — Proxy autenticado al endpoint /api/reportes/geo
 * del backend. Usado por el cliente Leaflet para refresh dinámico cuando
 * cambian los filtros (no recarga la página entera).
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listarReportesGeo } from '@/lib/backend';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const url = new URL(req.url);
  try {
    const items = await listarReportesGeo({
      desde: url.searchParams.get('desde') ?? undefined,
      hasta: url.searchParams.get('hasta') ?? undefined,
      tipo: url.searchParams.get('tipo') ?? undefined,
      provincia: url.searchParams.get('provincia') ?? undefined,
      // Sprint 2026-07-08 (fix Bug 2 mapa): permitir al panel interno pedir
      // los reportes pendientes/pendiente_revision además de aprobado/publicado.
      incluirPendientes:
        url.searchParams.get('incluir_pendientes')?.toLowerCase() === 'true',
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [], backendDown: true });
  }
}
