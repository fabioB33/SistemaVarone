import { listarReportes } from '@/lib/backend';
import { EstadoTabs, type Estado } from '@/components/estado-tabs';
import { ReporteCard } from '@/components/reporte-card';
import { PublicarSitioButton } from '@/components/accion-buttons';
import { WaStatusPanel } from '@/components/wa-status-panel';
import {
  Inbox,
  CheckCircle2,
  Globe,
  Trash2,
  Sparkles,
  Activity,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const VALID_ESTADOS: readonly Estado[] = ['pendiente', 'aprobado', 'publicado', 'descartado'] as const;

function isValid(value: string | undefined): value is Estado {
  return !!value && (VALID_ESTADOS as readonly string[]).includes(value);
}

export default async function AprobacionPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const sp = await searchParams;
  const estado: Estado = isValid(sp.estado) ? sp.estado : 'pendiente';

  const [pendientes, aprobados, publicados, descartados, items] = await Promise.all([
    listarReportes('pendiente'),
    listarReportes('aprobado'),
    listarReportes('publicado'),
    listarReportes('descartado'),
    listarReportes(estado),
  ]);

  const counts = {
    pendiente: pendientes.length,
    aprobado: aprobados.length,
    publicado: publicados.length,
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
            Centro de control · IA full-auto
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Reportes auto-publicados por IA
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            La IA Gemini clasifica los mensajes del grupo y manda a Framer los que pasan los criterios.
            Si algo se publicó mal, despublicalo desde la pestaña correspondiente.
          </p>
        </div>
        <PublicarSitioButton pendientesPublicar={counts.aprobado} />
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          icon={Inbox}
          label="Reintentando"
          value={counts.pendiente}
          accent={counts.pendiente > 0 ? 'warn' : 'muted'}
        />
        <Kpi icon={CheckCircle2} label="Listos para publicar" value={counts.aprobado} accent={counts.aprobado > 0 ? 'info' : 'muted'} />
        <Kpi icon={Globe} label="Publicados" value={counts.publicado} accent="ok" />
        <Kpi icon={Trash2} label="Descartados" value={counts.descartado} accent="muted" />
      </div>

      {/* Layout dos columnas */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <EstadoTabs estado={estado} counts={counts} />

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
  accent: 'warn' | 'info' | 'ok' | 'muted';
}) {
  const accentMap = {
    warn:   { iconCls: 'text-warn',  valueCls: 'text-fg' },
    info:   { iconCls: 'text-info',  valueCls: 'text-fg' },
    ok:     { iconCls: 'text-ok',    valueCls: 'text-fg' },
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
      title: 'Sin reintentos pendientes',
      desc: 'Todos los reportes recientes pasaron la IA y se enviaron a Framer sin errores.',
    },
    aprobado: {
      icon: CheckCircle2,
      title: 'Sin reportes esperando publicación',
      desc: 'Cuando la IA apruebe nuevos reportes aparecen acá hasta que el cron publique el sitio (9 AM y 21 hs Argentina).',
    },
    publicado: {
      icon: Globe,
      title: 'Aún no hay publicados',
      desc: 'Los reportes ya visibles en el sitio público se listan acá. Si alguno está mal, podés despublicarlo.',
    },
    descartado: {
      icon: Trash2,
      title: 'Papelera vacía',
      desc: 'Reportes descartados por la IA o despublicados manualmente quedan acá como referencia.',
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
