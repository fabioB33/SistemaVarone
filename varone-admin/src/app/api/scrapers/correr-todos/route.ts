import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { correrTodosLosScrapers } from '@/lib/backend';

/**
 * Sprint demo-readiness (2026-06-30) — Proxy autenticado al disparo de
 * los 6 scrapers en paralelo. Botón "Scrapear ahora" del dashboard.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  const r = await correrTodosLosScrapers();
  return NextResponse.json(r);
}
