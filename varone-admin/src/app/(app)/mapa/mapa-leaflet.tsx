'use client';

/**
 * Sprint mapa (2026-06-27) — Mapa Leaflet client-only.
 *
 * Renderea cluster markers de reportes en el mapa de Argentina.
 *
 * IMPORTANTE: este componente NO debe ser importado directamente desde un
 * Server Component. Se importa con `dynamic({ssr:false})` desde page.tsx —
 * Leaflet requiere `window` que no existe en SSR.
 */

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { ReporteGeoItem, ReportesGeoFiltros } from '@/lib/backend';

const TIPOS_INCIDENTE = [
  { value: '', label: 'Todos los tipos' },
  { value: 'robo_de_carga', label: 'Robo de carga' },
  { value: 'asalto', label: 'Asalto' },
  { value: 'tentativa', label: 'Tentativa' },
  { value: 'bloqueo', label: 'Bloqueo' },
  { value: 'alerta', label: 'Alerta' },
];

const COLOR_POR_TIPO: Record<string, string> = {
  robo_de_carga: '#ef4444',  // red-500
  asalto: '#f97316',          // orange-500
  tentativa: '#eab308',       // yellow-500
  bloqueo: '#a855f7',         // purple-500
  alerta: '#3b82f6',          // blue-500
};

const COLOR_POR_DEFECTO = '#6b7280'; // gray-500

// Centro de Argentina — Córdoba aproximado para mostrar mapa completo.
const CENTRO_AR: [number, number] = [-34.6037, -58.3816]; // CABA
const ZOOM_INICIAL = 6;

interface Props {
  initialItems: ReporteGeoItem[];
}

export function MapaLeaflet({ initialItems }: Props) {
  const [items, setItems] = useState<ReporteGeoItem[]>(initialItems);
  const [filtros, setFiltros] = useState<ReportesGeoFiltros>({});
  const [loading, setLoading] = useState(false);

  async function aplicarFiltros() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtros.tipo) params.set('tipo', filtros.tipo);
      if (filtros.desde) params.set('desde', filtros.desde);
      if (filtros.hasta) params.set('hasta', filtros.hasta);
      const r = await fetch(`/api/mapa/reportes-geo?${params.toString()}`);
      if (r.ok) {
        const j = (await r.json()) as { items?: ReporteGeoItem[] };
        setItems(j.items || []);
      }
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch cuando cambian filtros
  useEffect(() => {
    aplicarFiltros();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.tipo, filtros.desde, filtros.hasta]);

  // Contadores por tipo para la leyenda
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const item of items) {
      m[item.tipo_incidente] = (m[item.tipo_incidente] ?? 0) + 1;
    }
    return m;
  }, [items]);

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-bg-elevated p-3">
        <label className="block">
          <span className="block text-2xs font-medium uppercase tracking-wide text-fg-muted">Tipo</span>
          <select
            value={filtros.tipo ?? ''}
            onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value || undefined })}
            className="mt-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          >
            {TIPOS_INCIDENTE.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-2xs font-medium uppercase tracking-wide text-fg-muted">Desde</span>
          <input
            type="date"
            value={filtros.desde ?? ''}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value || undefined })}
            className="mt-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          />
        </label>

        <label className="block">
          <span className="block text-2xs font-medium uppercase tracking-wide text-fg-muted">Hasta</span>
          <input
            type="date"
            value={filtros.hasta ?? ''}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value || undefined })}
            className="mt-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          />
        </label>

        <div className="ml-auto flex items-center gap-3 text-xs text-fg-muted">
          <span>{items.length} reportes en mapa</span>
          {loading && <span className="text-amber-500">Cargando…</span>}
        </div>
      </div>

      {/* Leyenda compacta */}
      <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
        {Object.entries(counts).map(([tipo, count]) => (
          <span key={tipo} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: COLOR_POR_TIPO[tipo] ?? COLOR_POR_DEFECTO }}
            />
            {tipo} ({count})
          </span>
        ))}
      </div>

      {/* Mapa */}
      <div className="overflow-hidden rounded-lg border border-border" style={{ height: 600 }}>
        <MapContainer center={CENTRO_AR} zoom={ZOOM_INICIAL} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {items.map((item) => (
            <CircleMarker
              key={item.id}
              center={[item.lat, item.lng]}
              radius={8}
              pathOptions={{
                color: COLOR_POR_TIPO[item.tipo_incidente] ?? COLOR_POR_DEFECTO,
                fillColor: COLOR_POR_TIPO[item.tipo_incidente] ?? COLOR_POR_DEFECTO,
                fillOpacity: 0.65,
                weight: 2,
              }}
            >
              <Popup>
                <div className="space-y-1 text-xs">
                  <p className="font-semibold">
                    #{item.id} · {item.tipo_incidente}
                  </p>
                  <p>{item.ubicacion}{item.ruta && ` · ${item.ruta}`}</p>
                  <p className="text-gray-600">{item.fecha}{item.hora && ` ${item.hora}`}</p>
                  <p className="mt-1 line-clamp-3 text-gray-700">{item.descripcion}</p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
