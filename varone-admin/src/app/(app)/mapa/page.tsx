/**
 * Sprint mapa (2026-06-27) — Página /mapa.
 *
 * Server Component que carga la data inicial server-side (rápido para el primer
 * paint) + delega el render del mapa a un Client Component wrapper (Leaflet
 * requiere window).
 */

import { Map, AlertCircle } from 'lucide-react';
import { listarReportesGeo, obtenerStatsGeocoding } from '@/lib/backend';
import { MapaClientWrapper } from './mapa-client-wrapper';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MapaPage() {
  const [items, stats] = await Promise.all([
    listarReportesGeo(),
    obtenerStatsGeocoding(),
  ]);

  const totalReportesPendientesGeocoding = stats?.pendientes ?? 0;
  const reportesConCoords = items.length;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            <Map className="size-3 text-accent" />
            Visualización geográfica · Sprint mapa
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Mapa de incidentes
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            Reportes aprobados/publicados de los últimos 30 días con coordenadas
            resueltas. Pin click → detalle del incidente. Zoom mouse-wheel.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-lg border border-border bg-bg-elevated px-4 py-2.5">
            <p className="text-2xs uppercase tracking-wide text-fg-muted">En mapa</p>
            <p className="mt-0.5 text-2xl font-bold text-accent">
              {reportesConCoords}
            </p>
          </div>
          {totalReportesPendientesGeocoding > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
              <p className="text-2xs uppercase tracking-wide text-fg-muted">Sin geocoder</p>
              <p className="mt-0.5 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {totalReportesPendientesGeocoding}
              </p>
            </div>
          )}
        </div>
      </header>

      {items.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <AlertCircle className="size-5 text-amber-500" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-fg">No hay reportes con coordenadas todavía</p>
            <p className="text-xs text-fg-muted">
              El cron de geocoding corre todos los días a las 4 AM. Si recién aplicaste
              el sprint, podés disparar el batch manualmente desde el endpoint
              <code className="mx-1 rounded bg-bg px-1.5 py-0.5 text-2xs">/api/ubicaciones/geocodear-batch</code>
              o esperar al próximo ciclo. {totalReportesPendientesGeocoding} ubicaciones
              esperando ser resueltas.
            </p>
          </div>
        </div>
      )}

      <MapaClientWrapper initialItems={items} />
    </section>
  );
}
