/**
 * Sprint scrapers-portales (2026-06-30) — Página /descartados.
 *
 * Auditoría de las notas que el pre-filtro tiró antes de gastar quota de IA.
 * Sirve para tunear whitelist/blacklist las primeras semanas.
 *
 * Filtros:
 *  - razon: 'blacklist' (matchea palabras como narco/droga/etc.) vs 'sin-keywords'
 *  - portal: ver descartes de un portal específico
 *
 * Esta pantalla NO ofrece acciones (no se "des-descarta" una nota). Es solo
 * read-only para entender el comportamiento del pre-filtro.
 */

import Link from 'next/link';
import { ExternalLink, Filter, Trash2 } from 'lucide-react';
import { listarDescartados, contarDescartados } from '@/lib/backend';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const PORTAL_LABELS: Record<string, string> = {
  'cronica': 'Crónica',
  'diario-popular': 'Diario Popular',
  'infobae': 'Infobae',
  'la-nacion': 'La Nación',
  'clarin': 'Clarín',
  'pagina12': 'Página 12',
};

interface Props {
  searchParams: Promise<{ portal?: string; razon?: string }>;
}

export default async function DescartadosPage({ searchParams }: Props) {
  const params = await searchParams;
  const portalFilter = params.portal;
  const razonFilter = (params.razon === 'blacklist' || params.razon === 'sin-keywords')
    ? params.razon
    : undefined;

  const [items, counts] = await Promise.all([
    listarDescartados({
      portal: portalFilter,
      razon: razonFilter,
      limit: 100,
    }),
    contarDescartados(),
  ]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            <Filter className="size-3 text-amber-500" />
            Auditoría · Sprint scrapers-portales
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Notas descartadas
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted max-w-2xl">
            Notas que los scrapers trajeron pero el pre-filtro descartó antes de
            llamar a la IA. Útil para tunear las keywords del nicho.
            <strong className="text-fg"> Esto AHORRA quota de Gemini.</strong>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-bg-elevated px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wide text-fg-muted">7 días</p>
          <p className="mt-0.5 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {counts.total}
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/descartados"
          className={`rounded-md border px-3 py-1.5 text-xs ${
            !portalFilter && !razonFilter
              ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-soft'
          }`}
        >
          Todos
        </Link>
        <Link
          href="/descartados?razon=blacklist"
          className={`rounded-md border px-3 py-1.5 text-xs ${
            razonFilter === 'blacklist'
              ? 'border-red-500 bg-red-500/10 text-red-600 dark:text-red-400'
              : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-soft'
          }`}
        >
          🚫 Blacklist (narco, animales, etc.)
        </Link>
        <Link
          href="/descartados?razon=sin-keywords"
          className={`rounded-md border px-3 py-1.5 text-xs ${
            razonFilter === 'sin-keywords'
              ? 'border-fg/40 bg-bg-soft text-fg'
              : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-soft'
          }`}
        >
          ⚪ Sin keywords del nicho
        </Link>
        <span className="mx-2 text-fg-muted">|</span>
        {counts.porPortal.map((p) => (
          <Link
            key={p.portal}
            href={`/descartados?portal=${p.portal}`}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              portalFilter === p.portal
                ? 'border-fg/40 bg-bg-soft text-fg'
                : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-soft'
            }`}
          >
            📰 {PORTAL_LABELS[p.portal] || p.portal} <span className="text-fg-muted">({p._count})</span>
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-bg-elevated/50 px-6 py-12 text-center">
          <div className="rounded-full bg-fg-muted/10 p-3">
            <Trash2 className="size-8 text-fg-muted" />
          </div>
          <div>
            <p className="text-sm font-semibold text-fg">Sin descartes</p>
            <p className="mt-1 text-xs text-fg-muted">
              Los scrapers todavía no corrieron, o no descartaron nada con estos filtros.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <article
              key={d.id}
              className={`rounded-lg border p-4 ${
                d.razon === 'blacklist'
                  ? 'border-red-500/30 bg-red-500/5'
                  : 'border-border bg-bg-elevated/50'
              }`}
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-2xs uppercase tracking-wide text-fg-muted">
                    📰 {PORTAL_LABELS[d.portal] || d.portal} · {formatDate(d.descartadoEn)}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-fg">{d.titulo}</h3>
                  {d.resumen && (
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{d.resumen}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    d.razon === 'blacklist'
                      ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                      : 'bg-fg-muted/20 text-fg-muted'
                  }`}
                >
                  {d.razon === 'blacklist' ? '🚫 Blacklist' : '⚪ Sin keywords'}
                </span>
              </header>

              {d.matchedKeywords.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-2xs uppercase tracking-wide text-fg-muted">Matches:</span>
                  {d.matchedKeywords.map((k) => (
                    <span
                      key={k}
                      className="rounded bg-fg-muted/10 px-2 py-0.5 text-2xs font-mono text-fg-muted"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}

              {d.url && (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-amber-600 hover:underline dark:text-amber-400"
                >
                  <ExternalLink className="size-3" />
                  Ver nota original
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
