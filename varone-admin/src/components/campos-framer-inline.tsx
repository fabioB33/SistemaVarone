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
import { useRouter } from 'next/navigation';
import { Check, AlertCircle, Save, RotateCcw, X } from 'lucide-react';
import { CAMPOS_FRAMER_SPEC, ORDEN_CAMPOS_FRAMER } from '@/lib/enums-framer';
import type { ReporteListItem, ReporteEditableFields } from '@/lib/backend';
import { completarCamposFramerAction } from '@/app/(app)/aprobacion/actions';
import { reintentarPublicacionAction } from '@/app/(app)/errores-publicacion/actions';
import { toast } from './toast-container';

interface Props {
  reporte: ReporteListItem;
  // Sprint flujo-errores-editables (2026-06-30): modo "corregir error de
  // publicación". Cuando true:
  //  - TODOS los 10 dropdowns son editables (no solo los faltantes)
  //  - El campo culpable (framerLastErrorField) sale en rojo destacado
  //  - El botón cambia a "Corregir y reintentar" + dispara retry post-save
  modoCorrecciónFallo?: boolean;
}

export function CamposFramerInline({ reporte, modoCorrecciónFallo = false }: Props) {
  const router = useRouter();
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
  // Sprint flujo-errores-editables: campo culpable del fallo + valor intentado.
  const campoCulpable = modoCorrecciónFallo ? (reporte.framerLastErrorField ?? null) : null;
  const valorCulpable = modoCorrecciónFallo ? (reporte.framerLastErrorValue ?? null) : null;

  function handleChange(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const cambios: ReporteEditableFields = {};
    if (modoCorrecciónFallo) {
      // Sprint flujo-errores-editables: en modo fallo, enviamos TODOS los
      // campos editados que difieren del valor actual del reporte.
      // Esto permite corregir cualquier dropdown que el moderador detecte mal,
      // no solo el campo culpable del último error.
      for (const key of ORDEN_CAMPOS_FRAMER) {
        const nuevo = values[key];
        const actual = (reporte[key as keyof ReporteListItem] as string | null) ?? '';
        if (nuevo && nuevo.trim() !== '' && nuevo !== actual) {
          (cambios as Record<string, string>)[key] = nuevo;
        }
      }
      if (Object.keys(cambios).length === 0) {
        setError('No cambiaste ningún campo. Si el problema persiste, descartá el reporte.');
        return;
      }
    } else {
      // Modo legacy (camposFaltantes): solo enviamos los faltantes que la IA
      // no resolvió. Los OK no se tocan.
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
    }

    startTransition(async () => {
      try {
        const r = await completarCamposFramerAction(reporte.id, cambios);
        if (!r.ok) {
          setError(r.error || 'Error al guardar');
          toast('error', r.error || 'No se pudo guardar la corrección');
          return;
        }
        // Sprint flujo-errores-editables: tras guardar OK, si estamos en modo
        // fallo disparamos reintento del publisher automático.
        if (modoCorrecciónFallo) {
          toast('info', 'Corregido. Reintentando publicación…');
          const retry = await reintentarPublicacionAction(reporte.id);
          if (!retry.ok) {
            toast('error', retry.error || 'El reintento falló');
          } else {
            toast('success', '✅ Corrección guardada y reintento disparado');
          }
          router.refresh();
        }
        // En modo legacy, la Server Action ya hace revalidatePath.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado');
      }
    });
  }

  return (
    <div className={`mt-4 rounded-md border p-3 ${
      modoCorrecciónFallo ? 'border-red-500/30 bg-red-500/5' : 'border-line bg-canvas/40'
    }`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {modoCorrecciónFallo ? 'Corregir campos del incidente' : 'Datos del incidente'}
        </h4>
        {modoCorrecciónFallo && campoCulpable && valorCulpable && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-2xs font-semibold text-red-600 dark:text-red-400">
            🚫 "{valorCulpable}" no existe en el form público
          </span>
        )}
        {!modoCorrecciónFallo && tieneFaltantes && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-semibold text-amber-600 dark:text-amber-400">
            {faltantes.length} faltante{faltantes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {modoCorrecciónFallo && (
        <p className="mb-3 text-2xs text-fg-muted">
          El publisher no pudo postear este reporte porque algún valor no está en el form público.
          Corregí el campo en rojo (o cualquier otro que veas mal) y guardá para reintentar.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          {ORDEN_CAMPOS_FRAMER.map((key) => {
            const spec = CAMPOS_FRAMER_SPEC[key];
            if (!spec) return null;
            const esFaltante = faltantes.includes(key);
            const esCulpableDelFallo = modoCorrecciónFallo && campoCulpable === key;
            const valor = (reporte[key as keyof ReporteListItem] as string | null) ?? '';

            // Modo corrección fallo: TODOS los campos son selects editables.
            // El culpable del error sale en rojo destacado.
            if (modoCorrecciónFallo) {
              const colorBorder = esCulpableDelFallo
                ? 'border-red-500/40 bg-red-500/5'
                : 'border-line bg-bg-elevated';
              const colorLabel = esCulpableDelFallo
                ? 'text-red-600 dark:text-red-400'
                : 'text-fg-muted';
              const colorSelectBorder = esCulpableDelFallo
                ? 'border-red-500/40 focus:border-red-500'
                : 'border-line focus:border-accent';
              return (
                <div key={key} className={`rounded border p-2 ${colorBorder}`}>
                  <label className="block">
                    <span className={`block text-2xs font-semibold uppercase tracking-wider ${colorLabel}`}>
                      {esCulpableDelFallo ? '🚫 ' : ''}{spec.label}
                    </span>
                    {esCulpableDelFallo && valorCulpable && (
                      <span className="block text-2xs text-red-500 dark:text-red-400">
                        Valor actual <strong>"{valorCulpable}"</strong> no es válido. Elegí uno de la lista.
                      </span>
                    )}
                    {!esCulpableDelFallo && spec.ayuda && (
                      <span className="block text-2xs text-fg-muted">{spec.ayuda}</span>
                    )}
                    <select
                      value={values[key] ?? ''}
                      onChange={(e) => handleChange(key, e.target.value)}
                      disabled={pending}
                      className={`mt-1 block w-full rounded border bg-bg-elevated px-1.5 py-1 text-xs text-fg focus:outline-none ${colorSelectBorder}`}
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

            if (esFaltante) {
              // Modo legacy: select amber inline para que Varone complete
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

        {modoCorrecciónFallo ? (
          <button
            type="submit"
            disabled={pending}
            className="vc-btn vc-btn-primary vc-btn-sm w-full"
          >
            {pending ? (
              <RotateCcw className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            {pending ? 'Corrigiendo y reintentando…' : 'Corregir y reintentar publicación'}
          </button>
        ) : tieneFaltantes ? (
          <button
            type="submit"
            disabled={pending}
            className="vc-btn vc-btn-warning vc-btn-sm w-full"
          >
            <Save className="size-3.5" />
            {pending ? 'Guardando…' : `Guardar dropdowns y habilitar "Aprobar"`}
          </button>
        ) : null}
      </form>
    </div>
  );
}
