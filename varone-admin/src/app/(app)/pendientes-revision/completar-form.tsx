'use client';

/**
 * Sprint pivot-framer-form (2026-06-26) — Form para completar los dropdowns
 * que la IA dejó faltantes.
 *
 * Muestra solo los campos en `camposFaltantes` (no abruma con los 10 si solo
 * faltan 2). Cuando Varone guarda, el backend recalcula faltantes — si todos
 * los obligatorios están OK, el reporte transiciona automáticamente a
 * estado=pendiente (listo para aprobación).
 */

import { useState, useTransition } from 'react';
import type { ReporteListItem, ReporteEditableFields } from '@/lib/backend';
import { CAMPOS_FRAMER_SPEC, ORDEN_CAMPOS_FRAMER } from '@/lib/enums-framer';
import { PENDIENTES_REVISION_REFRESH_EVENT } from '@/components/pendientes-revision-badge';
import { completarCamposFramerAction, descartarPendienteRevisionAction } from './actions';

// Sprint hardening 13-mejoras (2026-06-27): dispatch evento custom para que
// el badge se refresque inmediato sin esperar el poll de 30s.
function dispararRefreshBadge() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PENDIENTES_REVISION_REFRESH_EVENT));
  }
}

interface Props {
  reporte: ReporteListItem;
}

export function CompletarForm({ reporte }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of ORDEN_CAMPOS_FRAMER) {
      init[key] = (reporte[key as keyof ReporteListItem] as string | null) ?? '';
    }
    return init;
  });

  function handleChange(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Solo enviamos los campos que están en camposFaltantes (los que la IA no
    // pudo elegir). Los que ya tenían valor canonical NO se tocan.
    const cambios: ReporteEditableFields = {};
    for (const key of reporte.camposFaltantes) {
      const v = values[key];
      if (v && v.trim() !== '') {
        (cambios as Record<string, string>)[key] = v;
      }
    }
    if (Object.keys(cambios).length === 0) {
      setError('Tenés que completar al menos un campo.');
      return;
    }

    startTransition(async () => {
      try {
        const r = await completarCamposFramerAction(reporte.id, cambios);
        if (!r.ok) {
          setError(r.error || 'Error desconocido');
        } else {
          dispararRefreshBadge();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado');
      }
    });
  }

  function handleDescartar() {
    if (!confirm('¿Seguro que querés descartar este reporte? No se publicará en el sitio.')) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await descartarPendienteRevisionAction(reporte.id);
        if (!r.ok) {
          setError(r.error || 'Error al descartar');
        } else {
          dispararRefreshBadge();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado');
      }
    });
  }

  const faltantes = reporte.camposFaltantes;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">
            Reporte #{reporte.id} · {reporte.tipoIncidente}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {reporte.ubicacion} {reporte.ruta && `· ${reporte.ruta}`} · {reporte.fecha}
          </p>
          <p className="mt-1.5 line-clamp-2 text-xs text-fg-muted">
            {reporte.descripcion}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
          {faltantes.length} faltante{faltantes.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {faltantes.map((key) => {
          const spec = CAMPOS_FRAMER_SPEC[key];
          if (!spec) return null;
          return (
            <label key={key} className="block">
              <span className="block text-xs font-medium text-fg">{spec.label}</span>
              {spec.ayuda && (
                <span className="mt-0.5 block text-2xs text-fg-muted">{spec.ayuda}</span>
              )}
              <select
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                required
              >
                <option value="">Seleccionar...</option>
                {spec.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      {error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Completar y mover a pendientes'}
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
    </form>
  );
}
