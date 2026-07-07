import { listarReportes } from '@/lib/backend';
import { EstadoTabs, type Estado } from '@/components/estado-tabs';
import { ReporteCard } from '@/components/reporte-card';
import { WaStatusPanel } from '@/components/wa-status-panel';
import { FuenteFilter } from '@/components/fuente-filter';
// Sprint flow-cleanup-legacy (2026-06-30): PublicarSitioButton removido.
// Era del flow viejo (cron 9 AM publish del sitio entero). Hoy el publisher
// Playwright postea inmediato al aprobar, no hace falta paso intermedio.
import {
  Inbox,
  Loader2,
  Globe,
  Trash2,
  Sparkles,
  Activity,
  AlertCircle,
} from 'lucide-react';
import { FlowExplainer } from './flow-explainer';
import { AnalizarUrlDialog } from './analizar-url-dialog';

export const dynamic = 'force-dynamic';

// Sprint flow-claridad (2026-06-30): + fallo_publicacion como estado válido.
const VALID_ESTADOS: readonly Estado[] = ['pendiente', 'aprobado', 'publicado', 'fallo_publicacion', 'descartado'] as const;

function isValid(value: string | undefined): value is Estado {
  return !!value && (VALID_ESTADOS as readonly string[]).includes(value);
}

export default async function AprobacionPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; fuente?: string }>;
}) {
  const sp = await searchParams;
  const estado: Estado = isValid(sp.estado) ? sp.estado : 'pendiente';
  // Sprint sugerencias-extras (2026-06-30): filtro por fuente.
  const fuente: 'todos' | 'whatsapp' | 'scraping' =
    sp.fuente === 'whatsapp' || sp.fuente === 'scraping' ? sp.fuente : 'todos';

  const [pendientes, aprobados, publicados, fallosPublic, descartados, itemsRaw] = await Promise.all([
    listarReportes('pendiente'),
    listarReportes('aprobado'),
    listarReportes('publicado'),
    listarReportes('fallo_publicacion'),
    listarReportes('descartado'),
    listarReportes(estado),
  ]);

  // Aplicar filtro por fuente client-side (el backend ya retorna todos los del estado).
  const items =
    fuente === 'todos' ? itemsRaw : itemsRaw.filter((r) => r.fuente === fuente);

  const counts = {
    pendiente: pendientes.length,
    aprobado: aprobados.length,
    publicado: publicados.length,
    fallo_publicacion: fallosPublic.length,
    descartado: descartados.length,
  };

  const totalProcessed = counts.aprobado + counts.publicado + counts.descartado;
  const completionRate =
    totalProcessed + counts.pendiente > 0
      ? Math.round((totalProcessed / (totalProcessed + counts.pendiente)) * 100)
      : 100;

  return (
    <section className="space-y-6">
      {/* Page header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            <Activity className="size-3 text-accent" />
            Centro de control · Review-first
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Aprobación de reportes
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            La IA Gemini clasifica los mensajes del grupo y de portales policiales,
            y completa el formulario público. Si quedaron dropdowns ambiguos
            (amber), completalos y aprobá. Si todo está OK, click directo en
            "Aprobar y publicar".
          </p>
        </div>

        {/* Sprint 2026-07-07: análisis manual de URL (cierra gap del scraper) */}
        <AnalizarUrlDialog />
      </header>

      {/* Flow visual del estado de los reportes (Sprint flow-claridad 2026-06-30) */}
      <FlowExplainer counts={counts} />

      {/* KPI strip — 5 estados alineados con el flow real */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi
          icon={Inbox}
          label="Para aprobar"
          value={counts.pendiente}
          accent={counts.pendiente > 0 ? 'warn' : 'muted'}
        />
        <Kpi
          icon={Loader2}
          label="En publicación"
          value={counts.aprobado}
          accent={counts.aprobado > 0 ? 'info' : 'muted'}
        />
        <Kpi icon={Globe} label="Publicados" value={counts.publicado} accent="ok" />
        <Kpi
          icon={AlertCircle}
          label="Errores"
          value={counts.fallo_publicacion}
          accent={counts.fallo_publicacion > 0 ? 'danger' : 'muted'}
        />
        <Kpi icon={Trash2} label="Descartados" value={counts.descartado} accent="muted" />
      </div>

      {/* Layout dos columnas */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <EstadoTabs estado={estado} counts={counts} />

          {/* Sprint sugerencias-extras (2026-06-30): filtro por fuente. */}
          <FuenteFilter estado={estado} fuente={fuente} itemsAll={itemsRaw} />

          {items.length === 0 ? (
            <EmptyState estado={estado} />
          ) : (
            <div className="space-y-3">
              {items.map((r) => (
                <ReporteCard
                  key={r.id}
                  reporte={r}
                  // showActions=true en pendiente (manuales) y aprobado/publicado (Despublicar).
                  // En descartado no mostramos acciones — son terminales.
                  showActions={estado !== 'descartado'}
                />
              ))}
            </div>
          )}

          {/* Hint de completion solo si hay datos */}
          {(counts.pendiente > 0 || totalProcessed > 0) && (
            <div className="vc-card flex items-center gap-3 px-4 py-3 text-xs text-fg-muted">
              <Sparkles className="size-3.5 text-accent" />
              <span className="flex-1">
                Tasa de procesamiento: <strong className="font-semibold text-fg">{completionRate}%</strong>
                {' · '}
                {totalProcessed} resueltos sobre {totalProcessed + counts.pendiente} totales.
              </span>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-20 lg:h-fit">
          <WaStatusPanel />
        </div>
      </div>
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent: 'warn' | 'info' | 'ok' | 'danger' | 'muted';
}) {
  const accentMap = {
    warn:   { iconCls: 'text-warn',   valueCls: 'text-fg' },
    info:   { iconCls: 'text-info',   valueCls: 'text-fg' },
    ok:     { iconCls: 'text-ok',     valueCls: 'text-fg' },
    danger: { iconCls: 'text-danger', valueCls: 'text-fg' },
    muted:  { iconCls: 'text-fg-subtle', valueCls: 'text-fg-secondary' },
  } as const;
  const cfg = accentMap[accent];
  return (
    <div className="vc-card group p-4 transition-all hover:border-line-strong">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">
          {label}
        </span>
        <Icon className={`size-3.5 ${cfg.iconCls}`} />
      </div>
      <div className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${cfg.valueCls}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ estado }: { estado: Estado }) {
  const config: Record<Estado, { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }> = {
    pendiente: {
      icon: Inbox,
      title: 'No hay reportes pendientes',
      desc: 'Cuando llegue un mensaje al grupo de WhatsApp, la IA lo clasifica y aparece acá para que lo revises y apruebes.',
    },
    aprobado: {
      icon: Loader2,
      title: 'Sin reportes en publicación',
      desc: 'El publisher Playwright tarda 5-30s en postear cada reporte aprobado. Si quedan acá mucho tiempo, mirá la pestaña Errores.',
    },
    publicado: {
      icon: Globe,
      title: 'Aún no hay publicados',
      desc: 'Los reportes que ya llegaron al sitio público se listan acá.',
    },
    fallo_publicacion: {
      icon: AlertCircle,
      title: 'Sin errores de publicación',
      desc: 'Cuando el publisher Playwright falle (sitio caído, selector cambió, sesión vencida), los reportes aparecen acá para reintentar o descartar.',
    },
    descartado: {
      icon: Trash2,
      title: 'Papelera vacía',
      desc: 'Reportes que Varone descartó quedan acá como referencia.',
    },
  };
  const { icon: Icon, title, desc } = config[estado];

  return (
    <div className="vc-card grid place-items-center px-6 py-16 text-center animate-fade-in">
      <span className="grid size-14 place-items-center rounded-full bg-subtle/40 ring-1 ring-line">
        <Icon className="size-6 text-fg-subtle" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">{desc}</p>
    </div>
  );
}
