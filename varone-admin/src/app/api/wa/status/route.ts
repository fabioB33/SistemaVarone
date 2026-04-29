import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { obtenerWaStatus } from '@/lib/backend';

/**
 * Proxy autenticado a /api/wa/status del backend.
 * El cliente del browser no tiene `BACKEND_API_TOKEN` — lo tiene este server,
 * y solo si la cookie de sesión es válida.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const status = await obtenerWaStatus();
  if (!status) {
    return NextResponse.json(
      {
        status: 'disconnected',
        qr: null,
        groupName: null,
        pendientes: 0,
        ultimoReporteEn: null,
        ahora: new Date().toISOString(),
        backendDown: true,
      },
      { status: 200 },
    );
  }
  return NextResponse.json(status);
}
