'use client';

/**
 * Sprint mapa (2026-06-27) — Wrapper client para Leaflet.
 *
 * Next.js 15 NO permite `dynamic(ssr:false)` desde Server Components.
 * Por eso necesitamos este intermediario client que sí lo permite.
 */

import nextDynamic from 'next/dynamic';
import type { ReporteGeoItem } from '@/lib/backend';

const MapaLeaflet = nextDynamic(
  () => import('./mapa-leaflet').then((mod) => mod.MapaLeaflet),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-border bg-bg-elevated text-fg-muted">
        Cargando mapa…
      </div>
    ),
  },
);

interface Props {
  initialItems: ReporteGeoItem[];
}

export function MapaClientWrapper({ initialItems }: Props) {
  return <MapaLeaflet initialItems={initialItems} />;
}
