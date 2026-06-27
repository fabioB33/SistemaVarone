/**
 * Sprint hardening 13-mejoras (2026-06-27) — Página de errores de publicación.
 *
 * Lista los reportes en estado=fallo_publicacion (aprobados que el
 * framer-publisher v2 no pudo postear, generalmente porque agotó retries con
 * el backoff exponencial). Varone puede reintentar manualmente o descartar.
 *
 * Espejo del pattern de /pendientes-revision (página + Server Action + client
 * cards + revalidatePath).
 */

import { listarReportes } from '@/lib/backend';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { ErrorCard } from './error-card';

export const dynamic = 'force-dynamic';

export default async function ErroresPublicacionPage() {
  const items = await listarReportes('fallo_publicacion');

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            <AlertCircle className="size-3 text-red-500" />
            Acción requerida · Sprint hardening
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Errores de publicación
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            Reportes aprobados que el publisher no pudo postear al formulario
            público (sitio caído, sesión vencida, selector cambió, etc).
            Reintentá o descartá según el caso.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-bg-elevated px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wide text-fg-muted">En fallo</p>
          <p className="mt-0.5 text-2xl font-bold text-red-600 dark:text-red-400">
            {items.length}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-bg-elevated/50 px-6 py-12 text-center">
          <div className="rounded-full bg-emerald-500/10 p-3">
            <ShieldCheck className="size-8 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-fg">Todo OK — sin fallos de publicación</p>
            <p className="mt-1 text-xs text-fg-muted">
              Cuando un reporte aprobado no se pueda publicar después de los
              reintentos automáticos, aparecerá acá.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((reporte) => (
            <ErrorCard key={reporte.id} reporte={reporte} />
          ))}
        </div>
      )}
    </section>
  );
}
