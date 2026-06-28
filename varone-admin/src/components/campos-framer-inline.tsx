'use client';

/**
 * Sprint flow-unificado-aprobacion (2026-06-28) — Bloque inline con los
 * 10 campos canonical del formulario público + selects amber para los
 * faltantes.
 *
 * Antes vivían en una página separada (/pendientes-revision), ahora son
 * parte de la card de /aprobacion. Pattern: "todo lo que requiere
 * acción humana en UN solo lugar".
 *
 * Cuando Varone completa los selects amber + click "Guardar dropdowns":
 * - Server Action edita el reporte con los nuevos valores
 * - Backend recalcula `camposFaltantes` (auto-vacía si todos OK)
 * - revalidatePath re-render la card sin los selects amber
 * - Botón "Aprobar" del padre se habilita automático
 */

import { useState, useTransition } from 'react';
import { Check, AlertCircle, Save } from 'lucide-react';
import { CAMPOS_FRAMER_SPEC, ORDEN_CAMPOS_FRAMER } from '@/lib/enums-framer';
import type { ReporteListItem, ReporteEditableFields } from '@/lib/backend';
import { completarCamposFramerAction } from '@/app/(app)/aprobacion/actions';

interface Props {
  reporte: ReporteListItem;
}

export function CamposFramerInline({ reporte }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of ORDEN_CAMPOS_FRAMER) {
      init[key] = (reporte[key as keyof ReporteListItem] as string | null) ?? '';
    }
    return init;
  });

  const faltantes = reporte.camposFaltantes ?? [];
  const tieneFaltantes = faltantes.length > 0;

  function handleChange(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Solo enviamos los que están en camposFaltantes (los OK ya pasaron por
    // el enum-matcher de la IA, no los tocamos).
    const cambios: ReporteEditableFields = {};
    for (const key of faltantes) {
      const v = values[key];
      if (v && v.trim() !== '') {
        (cambios as Record<string, string>)[key] = v;
      }
    }
    if (Object.keys(cambios).length === 0) {
      setError('Completá al menos un campo.');
      return;
    }

    startTransition(async () => {
      try {
        const r = await completarCamposFramerAction(reporte.id, cambios);
        if (!r.ok) setError(r.error || 'Error al guardar');
        // Si OK, revalidatePath en la action ya refrescó la página.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado');
      }
    });
  }

  return (
    <div className="mt-4 rounded-md border border-line bg-canvas/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Datos del incidente
        </h4>
        {tieneFaltantes && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-semibold text-amber-600 dark:text-amber-400">
            {faltantes.length} faltante{faltantes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          {ORDEN_CAMPOS_FRAMER.map((key) => {
            const spec = CAMPOS_FRAMER_SPEC[key];
            if (!spec) return null;
            const esFaltante = faltantes.includes(key);
            const valor = (reporte[key as keyof ReporteListItem] as string | null) ?? '';

            if (esFaltante) {
              // Select amber inline para que Varone complete
              return (
                <div key={key} className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
                  <label className="block">
                    <span className="block text-2xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      ⚠ {spec.label}
                    </span>
                    {spec.ayuda && (
                      <span className="block text-2xs text-fg-muted">{spec.ayuda}</span>
                    )}
                    <select
                      value={values[key] ?? ''}
                      onChange={(e) => handleChange(key, e.target.value)}
                      disabled={pending}
                      className="mt-1 block w-full rounded border border-amber-500/40 bg-bg-elevated px-1.5 py-1 text-xs text-fg focus:border-amber-500 focus:outline-none"
                      required
                    >
                      <option value="">Seleccionar…</option>
                      {spec.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              );
            }

            // Campo resuelto OK — render compacto
            return (
              <div key={key} className="flex items-baseline gap-2 leading-tight">
                <Check className="size-3 shrink-0 translate-y-0.5 text-ok" />
                <dt className="shrink-0 font-medium text-fg-muted">{spec.label}:</dt>
                <dd className="min-w-0 truncate text-fg-secondary">{valor || '—'}</dd>
              </div>
            );
          })}
        </dl>

        {error && (
          <p className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-2xs text-red-600 dark:text-red-400">
            <AlertCircle className="-mt-0.5 mr-1 inline size-3" />
            {error}
          </p>
        )}

        {tieneFaltantes && (
          <button
            type="submit"
            disabled={pending}
            className="vc-btn vc-btn-warning vc-btn-sm w-full"
          >
            <Save className="size-3.5" />
            {pending ? 'Guardando…' : `Guardar dropdowns y habilitar "Aprobar"`}
          </button>
        )}
      </form>
    </div>
  );
}
