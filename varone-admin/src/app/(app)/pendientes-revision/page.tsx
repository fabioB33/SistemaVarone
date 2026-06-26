/**
 * Sprint pivot-framer-form (2026-06-26) — Página de revisión.
 *
 * Lista los reportes en estado=pendiente_revision (la IA no pudo elegir ≥1
 * de los 10 dropdowns del formulario público). Varone completa manualmente
 * y al guardar el reporte transiciona a 'pendiente' si los obligatorios
 * están todos OK.
 */

import { listarReportes } from '@/lib/backend';
import { AlertTriangle, Inbox } from 'lucide-react';
import { CompletarForm } from './completar-form';

export const dynamic = 'force-dynamic';

export default async function PendientesRevisionPage() {
  const items = await listarReportes('pendiente_revision');

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            <AlertTriangle className="size-3 text-amber-500" />
            Acción requerida · Sprint pivot-framer-form
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Pendientes de revisión
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            La IA no pudo elegir uno o más dropdowns del formulario público.
            Completá los campos faltantes para que el reporte pueda publicarse en
            <span className="font-medium text-fg">
              {' '}
              pirateriadecamiones.com.ar/formulario-de-incidentes
            </span>
            .
          </p>
        </div>
        <div className="rounded-lg border border-border bg-bg-elevated px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wide text-fg-muted">Pendientes</p>
          <p className="mt-0.5 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {items.length}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-bg-elevated/50 px-6 py-12 text-center">
          <div className="rounded-full bg-emerald-500/10 p-3">
            <Inbox className="size-8 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-fg">No hay reportes para revisar</p>
            <p className="mt-1 text-xs text-fg-muted">
              Cuando la IA detecte un mensaje con dropdowns ambiguos aparecerá acá.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((reporte) => (
            <CompletarForm key={reporte.id} reporte={reporte} />
          ))}
        </div>
      )}
    </section>
  );
}
