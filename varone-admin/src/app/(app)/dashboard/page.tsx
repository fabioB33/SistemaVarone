/**
 * Sprint demo-readiness (2026-06-30) — Centro de Comando.
 *
 * Página de entrada de Varone post-login. Vista panorámica del sistema:
 *  - Counters de actividad hoy / 7d / por estado
 *  - Status de cada portal (verde/amber/rojo)
 *  - Botón "Scrapear ahora" → dispara los 6 scrapers en paralelo
 *  - Links rápidos a /aprobacion, /mapa, /descartados, /errores
 *
 * NO reemplaza a /aprobacion (Varone sigue trabajando ahí). Esta es la "home"
 * del panel admin.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Map as MapIcon,
  Trash2,
  Globe2,
  MessageSquare,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { obtenerDashboardCounters, obtenerScrapersStatus } from '@/lib/backend';
import { ScrapearAhoraButton } from './scrapear-ahora-button';
import { ReporteHoyCounter } from './reporte-hoy-counter';
import { WhatsAppWidget } from './whatsapp-widget';

export const dynamic = 'force-dynamic';

const PORTAL_LABELS: Record<string, string> = {
  cronica: 'Crónica',
  'diario-popular': 'Diario Popular',
  infobae: 'Infobae',
  'la-nacion': 'La Nación',
  clarin: 'Clarín',
  pagina12: 'Página 12',
};

export default async function DashboardPage() {
  const [counters, portales] = await Promise.all([
    obtenerDashboardCounters(),
    obtenerScrapersStatus(),
  ]);

  const c = counters ?? {
    estados: { pendientes: 0, aprobados: 0, publicados: 0, descartados: 0, falloPublicacion: 0 },
    actividad: { reportesHoy: 0, reportesEsteSemana: 0, descartesHoy: 0 },
    fuentes: { whatsapp7d: 0, scraping7d: 0 },
  };

  return (
    <section className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            <TrendingUp className="size-3 text-amber-500" />
            Centro de Comando · Sistema Varone
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Buenos días, Varone
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            Tu sistema escaneando WhatsApp + 6 portales policiales argentinos. Vista panorámica de la operación.
          </p>
        </div>
        <ScrapearAhoraButton />
      </header>

      {/* WhatsApp widget — visible al toque para que Varone sepa si el bot está vivo */}
      <WhatsAppWidget />

      {/* Actividad hoy / esta semana */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ReporteHoyCounter initialValue={c.actividad.reportesHoy} />

        <article className="rounded-lg border border-border bg-bg-elevated p-5">
          <p className="text-2xs uppercase tracking-wide text-fg-muted">Esta semana</p>
          <p className="mt-1 text-3xl font-bold text-fg">{c.actividad.reportesEsteSemana}</p>
          <p className="mt-1 text-xs text-fg-muted">últimos 7 días</p>
        </article>

        <article className="rounded-lg border border-border bg-bg-elevated p-5">
          <p className="text-2xs uppercase tracking-wide text-fg-muted">Descartes (24h)</p>
          <p className="mt-1 text-3xl font-bold text-fg-muted">{c.actividad.descartesHoy}</p>
          <p className="mt-1 text-xs text-fg-muted">
            <Link href="/descartados" className="text-amber-600 hover:underline dark:text-amber-400">
              Ver auditoría →
            </Link>
          </p>
        </article>
      </div>

      {/* Estados de reportes */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Pipeline de aprobación
        </h2>
        <div className="grid gap-3 sm:grid-cols-5">
          <Link
            href="/aprobacion?estado=pendiente"
            className="group rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10"
          >
            <p className="text-2xs uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Pendientes
            </p>
            <p className="mt-1 text-2xl font-bold text-fg">{c.estados.pendientes}</p>
            <p className="mt-1 text-2xs text-fg-muted">requiere acción →</p>
          </Link>
          <Link
            href="/aprobacion?estado=aprobado"
            className="rounded-lg border border-border bg-bg-elevated p-4 transition-colors hover:bg-bg-soft"
          >
            <p className="text-2xs uppercase tracking-wide text-fg-muted">Aprobados</p>
            <p className="mt-1 text-2xl font-bold text-fg">{c.estados.aprobados}</p>
            <p className="mt-1 text-2xs text-fg-muted">en cola publisher</p>
          </Link>
          <Link
            href="/aprobacion?estado=publicado"
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:bg-emerald-500/10"
          >
            <p className="text-2xs uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Publicados
            </p>
            <p className="mt-1 text-2xl font-bold text-fg">{c.estados.publicados}</p>
            <p className="mt-1 text-2xs text-fg-muted">en el sitio</p>
          </Link>
          <Link
            href="/errores-publicacion"
            className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 transition-colors hover:bg-red-500/10"
          >
            <p className="text-2xs uppercase tracking-wide text-red-600 dark:text-red-400">Errores</p>
            <p className="mt-1 text-2xl font-bold text-fg">{c.estados.falloPublicacion}</p>
            <p className="mt-1 text-2xs text-fg-muted">
              {c.estados.falloPublicacion > 0 ? 'requiere acción →' : 'todo OK'}
            </p>
          </Link>
          <Link
            href="/aprobacion?estado=descartado"
            className="rounded-lg border border-border bg-bg-elevated p-4 transition-colors hover:bg-bg-soft"
          >
            <p className="text-2xs uppercase tracking-wide text-fg-muted">Descartados</p>
            <p className="mt-1 text-2xl font-bold text-fg-muted">{c.estados.descartados}</p>
            <p className="mt-1 text-2xs text-fg-muted">por Varone</p>
          </Link>
        </div>
      </div>

      {/* Fuentes de entrada */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Fuentes (últimos 7 días)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <article className="rounded-lg border border-border bg-bg-elevated p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2">
                <MessageSquare className="size-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-fg">WhatsApp</p>
                <p className="text-2xs text-fg-muted">Grupo "Piratería de Camiones"</p>
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-fg">{c.fuentes.whatsapp7d}</p>
            <p className="text-2xs text-fg-muted">reportes en 7d</p>
          </article>

          <article className="rounded-lg border border-border bg-bg-elevated p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2">
                <Globe2 className="size-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-fg">Scraping 6 portales</p>
                <p className="text-2xs text-fg-muted">Crónica + 5 más</p>
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-fg">{c.fuentes.scraping7d}</p>
            <p className="text-2xs text-fg-muted">reportes en 7d</p>
          </article>
        </div>
      </div>

      {/* Status de cada portal */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Estado de scrapers (24h)
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {portales.map((p) => {
            const StatusIcon =
              p.status === 'healthy' ? CheckCircle2
              : p.status === 'stale' ? AlertCircle
              : HelpCircle;
            const colorBorder =
              p.status === 'healthy' ? 'border-emerald-500/30 bg-emerald-500/5'
              : p.status === 'stale' ? 'border-red-500/30 bg-red-500/5'
              : 'border-border bg-bg-elevated';
            const colorIcon =
              p.status === 'healthy' ? 'text-emerald-500'
              : p.status === 'stale' ? 'text-red-500'
              : 'text-fg-muted';
            return (
              <article key={p.portal} className={`rounded-lg border p-4 ${colorBorder}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-fg">
                      📰 {PORTAL_LABELS[p.portal] || p.portal}
                    </p>
                    <p className="mt-0.5 text-2xs text-fg-muted">
                      {p.reportes24h} reportes · {p.descartados24h} descartes (24h)
                    </p>
                  </div>
                  <StatusIcon className={`size-5 shrink-0 ${colorIcon}`} />
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Links rápidos a otras vistas */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/aprobacion?estado=pendiente"
          className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated p-4 transition-colors hover:bg-bg-soft"
        >
          <Inbox className="size-5 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-fg">Aprobación</p>
            <p className="text-2xs text-fg-muted">Revisar pendientes</p>
          </div>
        </Link>
        <Link
          href="/mapa"
          className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated p-4 transition-colors hover:bg-bg-soft"
        >
          <MapIcon className="size-5 text-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-fg">Mapa</p>
            <p className="text-2xs text-fg-muted">Hotspots geográficos</p>
          </div>
        </Link>
        <Link
          href="/descartados"
          className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated p-4 transition-colors hover:bg-bg-soft"
        >
          <Trash2 className="size-5 text-fg-muted" />
          <div>
            <p className="text-sm font-semibold text-fg">Descartes</p>
            <p className="text-2xs text-fg-muted">Auditar pre-filtro</p>
          </div>
        </Link>
      </div>
    </section>
  );
}
