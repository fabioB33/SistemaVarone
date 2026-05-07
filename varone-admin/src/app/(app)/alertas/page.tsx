import { listarAlertas, type AlertaItem } from '@/lib/backend';
import { formatDate, cn } from '@/lib/utils';
import {
  AlertCircle,
  BellOff,
  Volume2,
  TrendingUp,
  Clock4,
  PieChart,
  TestTube,
  Hash,
} from 'lucide-react';
import { MarcarVistaButton, MarcarTodasButton } from './marcar-buttons';

export const dynamic = 'force-dynamic';

const TIPO_CFG: Record<
  AlertaItem['tipo'],
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    color: string;
  }
> = {
  silencio: { icon: Volume2, label: 'Silencio sospechoso', color: 'text-warn' },
  spike: { icon: TrendingUp, label: 'Spike de aprobaciones', color: 'text-warn' },
  'pendientes-viejos': { icon: Clock4, label: 'Pendientes colgados', color: 'text-warn' },
  distribucion: { icon: PieChart, label: 'Distribución sospechosa', color: 'text-warn' },
  test: { icon: TestTube, label: 'Test', color: 'text-fg-muted' },
};

const SEVERIDAD_CFG = {
  info: { ring: 'border-info/30 bg-info/5', dot: 'bg-info' },
  warn: { ring: 'border-warn/30 bg-warn/5', dot: 'bg-warn' },
  error: { ring: 'border-danger/30 bg-danger/5', dot: 'bg-danger' },
} as const;

export default async function AlertasPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const sp = await searchParams;
  const soloSinLeer = sp.filtro === 'sin-leer';

  const items = await listarAlertas({ soloSinLeer, limit: 100 });
  const sinLeerCount = items.filter((a) => a.vistaEn === null).length;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            <AlertCircle className="size-3 text-warn" />
            Alertas operativas
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Notificaciones del sistema
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            Alertas detectadas por el chequeo horario de comportamiento de la IA. Quedan
            registradas acá aunque el bot WhatsApp no esté disponible para enviarlas.
          </p>
        </div>
        <MarcarTodasButton pendientes={sinLeerCount} />
      </header>

      {/* Tabs simple — sin leer / todas */}
      <nav className="vc-card flex gap-1 p-1" role="tablist">
        <FilterLink active={!soloSinLeer} href="/alertas" label="Todas" count={items.length} />
        <FilterLink active={soloSinLeer} href="/alertas?filtro=sin-leer" label="Sin leer" count={sinLeerCount} accent />
      </nav>

      {items.length === 0 ? (
        <EmptyState soloSinLeer={soloSinLeer} />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <AlertaCard key={a.id} alerta={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function FilterLink({
  active,
  href,
  label,
  count,
  accent = false,
}: {
  active: boolean;
  href: string;
  label: string;
  count: number;
  accent?: boolean;
}) {
  return (
    <a
      href={href}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all sm:flex-initial',
        active
          ? 'bg-accent text-accent-fg shadow-sm'
          : 'text-fg-muted hover:bg-subtle/60 hover:text-fg',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
          active && 'bg-accent-fg/15 text-accent-fg',
          !active && count === 0 && 'bg-subtle/60 text-fg-subtle',
          !active && count > 0 && accent && 'bg-warn/15 text-warn',
          !active && count > 0 && !accent && 'bg-subtle/80 text-fg-muted',
        )}
      >
        {count}
      </span>
    </a>
  );
}

function AlertaCard({ alerta }: { alerta: AlertaItem }) {
  const tipoCfg = TIPO_CFG[alerta.tipo] ?? TIPO_CFG.test;
  const sevCfg = SEVERIDAD_CFG[alerta.severidad as keyof typeof SEVERIDAD_CFG] ?? SEVERIDAD_CFG.warn;
  const Icon = tipoCfg.icon;
  const sinLeer = alerta.vistaEn === null;

  return (
    <article
      className={cn(
        'vc-card grid gap-4 p-5 transition-colors sm:grid-cols-[1fr,auto]',
        sevCfg.ring,
        sinLeer && 'shadow-sm',
      )}
    >
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="vc-badge vc-badge-default">
            <span className={cn('size-1.5 rounded-full', sevCfg.dot, sinLeer && 'animate-pulse-dot')} />
            {sinLeer ? 'Sin leer' : 'Vista'}
          </span>
          <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
            <Icon className={cn('size-3', tipoCfg.color)} />
            {tipoCfg.label}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-2xs text-fg-subtle">
            <Hash className="size-2.5" />
            {alerta.id}
          </span>
        </div>

        {/* Mensaje (preserva saltos de línea del notificador WhatsApp) */}
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg-secondary">
          {alerta.mensaje}
        </pre>

        {/* Meta + fechas */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-2xs text-fg-subtle">
          <span>Disparada: {formatDate(alerta.creadoEn)}</span>
          {alerta.vistaEn && <span>Vista: {formatDate(alerta.vistaEn)}</span>}
          <span>
            Envío: <span className={alerta.estadoEnvio === 'sent' ? 'text-ok' : 'text-warn'}>{alerta.estadoEnvio}</span>
          </span>
        </div>
      </div>

      {sinLeer && (
        <div className="sm:self-start">
          <MarcarVistaButton id={alerta.id} />
        </div>
      )}
    </article>
  );
}

function EmptyState({ soloSinLeer }: { soloSinLeer: boolean }) {
  return (
    <div className="vc-card grid place-items-center px-6 py-16 text-center animate-fade-in">
      <span className="grid size-14 place-items-center rounded-full bg-subtle/40 ring-1 ring-line">
        <BellOff className="size-6 text-fg-subtle" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-fg">
        {soloSinLeer ? 'Todo al día' : 'Sin alertas todavía'}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        {soloSinLeer
          ? 'No hay alertas sin leer. El sistema viene operando dentro de los parámetros normales.'
          : 'Cuando el chequeo horario detecte algo anómalo (silencio, spike, pendientes colgados, distribución sospechosa), las alertas aparecen acá.'}
      </p>
    </div>
  );
}

