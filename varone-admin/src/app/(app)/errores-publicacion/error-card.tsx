'use client';

/**
 * Sprint hardening 13-mejoras (2026-06-27) — card de reporte en fallo_publicacion.
 *
 * Muestra el reporte + botón "Reintentar" que dispara enviarAFramer inmediato
 * y "Descartar" que lo manda a descartado sin postear.
 */

import { useState, useTransition } from 'react';
import { AlertCircle } from 'lucide-react';
import type { ReporteListItem } from '@/lib/backend';
import { ERRORES_PUBLICACION_REFRESH_EVENT } from '@/components/errores-publicacion-badge';
import { reintentarPublicacionAction, descartarFalloAction } from './actions';

function dispararRefreshBadge() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ERRORES_PUBLICACION_REFRESH_EVENT));
  }
}

interface Props {
  reporte: ReporteListItem;
}

export function ErrorCard({ reporte }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleReintentar() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const r = await reintentarPublicacionAction(reporte.id);
        if (r.ok) {
          setSuccess('Reintento OK. El reporte está en proceso.');
          dispararRefreshBadge();
        } else {
          setError(r.error || 'Reintento falló');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado');
      }
    });
  }

  function handleDescartar() {
    if (!confirm('¿Descartar este reporte definitivamente? No se publicará.')) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const r = await descartarFalloAction(reporte.id);
        if (r.ok) {
          dispararRefreshBadge();
        } else {
          setError(r.error || 'Error al descartar');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado');
      }
    });
  }

  return (
    <article className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <AlertCircle className="size-4 text-red-500" />
            Reporte #{reporte.id} · {reporte.tipoIncidente}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {reporte.ubicacion}
            {reporte.ruta && ` · ${reporte.ruta}`} · {reporte.fecha}
            {reporte.hora && ` ${reporte.hora}`}
          </p>
          <p className="mt-1.5 line-clamp-2 text-xs text-fg-muted">
            {reporte.descripcion}
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          {success}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleReintentar}
          disabled={pending}
          className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {pending ? 'Reintentando…' : 'Reintentar publicación'}
        </button>
        <button
          type="button"
          onClick={handleDescartar}
          disabled={pending}
          className="rounded-md border border-border bg-bg-elevated px-3.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-soft hover:text-fg disabled:opacity-50"
        >
          Descartar
        </button>
      </div>
    </article>
  );
}
