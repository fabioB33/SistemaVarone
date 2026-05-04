'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  WifiOff,
  Smartphone,
  Clock,
  Inbox,
  RefreshCw,
  QrCode,
} from 'lucide-react';
import type { WaStatus } from '@/lib/backend';
import { cn, formatDate } from '@/lib/utils';

const POLL_FAST_MS = 3_000;
const POLL_SLOW_MS = 30_000;

export function WaStatusPanel() {
  const router = useRouter();
  const [data, setData] = useState<(WaStatus & { backendDown?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Espejo del status actual fuera del closure del useEffect — ASÍ el polling
  // siempre lee el último valor para decidir el intervalo (sin esto el closure
  // queda capturado con data=null y el polling nunca pasa al modo lento).
  const statusRef = useRef<WaStatus['status'] | null>(null);
  // Flag para detectar transiciones (qr → connected) y refrescar el resto
  // del panel cuando el bot recién se conecta.
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch('/api/wa/status', { cache: 'no-store' });
        if (!cancelled && r.ok) {
          const j = (await r.json()) as WaStatus & { backendDown?: boolean };
          setData(j);
          statusRef.current = j.status;
          // Transición a "connected": refrescar Server Components para
          // traer reportes nuevos y métricas frescas.
          if (j.status === 'connected' && !wasConnectedRef.current) {
            wasConnectedRef.current = true;
            router.refresh();
          } else if (j.status !== 'connected') {
            wasConnectedRef.current = false;
          }
        }
      } catch {
        // ignorar
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled) return;
      const interval = statusRef.current === 'connected' ? POLL_SLOW_MS : POLL_FAST_MS;
      timer = setTimeout(tick, interval);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <aside className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
          Estado del bot
        </h2>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="vc-btn vc-btn-ghost vc-btn-sm"
          aria-label="Refrescar estado"
          title="Refrescar ahora"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
        </button>
      </header>

      {!data && !loading && (
        <div className="vc-card p-4 text-xs text-fg-subtle">
          Sin datos del backend.
        </div>
      )}

      {data?.backendDown && <BackendDownAlert />}

      {data && !data.backendDown && (
        <div className="space-y-3 animate-fade-in">
          <StatusCard data={data} />
          {data.status === 'qr' && data.qr && <QrCard qr={data.qr} />}
          <StatsCard data={data} />
        </div>
      )}
    </aside>
  );
}

function BackendDownAlert() {
  return (
    <div className="vc-card overflow-hidden border-danger/30 bg-danger/5">
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-danger/15">
          <WifiOff className="size-4 text-danger" />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">Backend no responde</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            El sistema (puerto 3000) no está accesible. Verificá que esté corriendo.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ data }: { data: WaStatus }) {
  const map = {
    connected: {
      icon: CheckCircle2,
      ring: 'border-ok/30 bg-ok/5',
      iconBg: 'bg-ok/15',
      iconColor: 'text-ok',
      pulse: 'bg-ok',
      label: 'Operativo',
      labelColor: 'text-ok',
      title: 'Conectado',
      desc: data.groupName
        ? `Escuchando “${data.groupName}”.`
        : 'Escuchando el grupo configurado.',
    },
    qr: {
      icon: Smartphone,
      ring: 'border-warn/30 bg-warn/5',
      iconBg: 'bg-warn/15',
      iconColor: 'text-warn',
      pulse: 'bg-warn',
      label: 'Esperando',
      labelColor: 'text-warn',
      title: 'Vinculá tu WhatsApp',
      desc: 'Escaneá el código para activar el bot.',
    },
    disconnected: {
      icon: WifiOff,
      ring: 'border-danger/30 bg-danger/5',
      iconBg: 'bg-danger/15',
      iconColor: 'text-danger',
      pulse: 'bg-danger',
      label: 'Desconectado',
      labelColor: 'text-danger',
      title: 'Sin conexión',
      desc: 'No estás recibiendo mensajes.',
    },
  } as const;

  const cfg = map[data.status];
  const Icon = cfg.icon;
  const cargando = data.cargando === true;

  return (
    <div className={cn('vc-card overflow-hidden transition-colors', cfg.ring)}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-md ring-1 ring-line',
              cfg.iconBg,
              cargando && 'animate-pulse',
            )}
          >
            <Icon className={cn('size-5', cfg.iconColor)} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('text-2xs font-semibold uppercase tracking-wider', cfg.labelColor)}>
              <span className="mr-1.5 inline-flex">
                <span className={cn('size-1.5 rounded-full animate-pulse-dot', cfg.pulse)} />
              </span>
              {cargando ? 'Iniciando' : cfg.label}
            </p>
            <p className="mt-1 text-base font-semibold leading-tight text-fg">
              {cargando ? 'Conectando…' : cfg.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              {cargando
                ? `Verificando estado del bot. Último estado conocido: ${cfg.label.toLowerCase()}.`
                : cfg.desc}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function QrCard({ qr }: { qr: string }) {
  return (
    <div className="vc-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-subtle/40 px-4 py-2.5">
        <QrCode className="size-3.5 text-accent" />
        <span className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">
          Escaneá para vincular
        </span>
      </div>
      <div className="p-4">
        <div className="rounded-lg bg-white p-3 shadow-md ring-1 ring-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt="Código QR de WhatsApp Web — escanealo desde tu celular"
            className="block h-auto w-full"
          />
        </div>
        <ol className="mt-4 space-y-2 text-xs text-fg-muted">
          <Step n={1}>Abrí WhatsApp en tu celular.</Step>
          <Step n={2}>
            Tocá <strong className="text-fg-secondary">Configuración → Dispositivos vinculados</strong>.
          </Step>
          <Step n={3}>
            Tocá <strong className="text-fg-secondary">Vincular un dispositivo</strong> y apuntá la cámara.
          </Step>
        </ol>
        <p className="mt-3 text-2xs text-fg-subtle">
          El QR expira cada ~60 s. Si no llegás a tiempo se genera otro automáticamente.
        </p>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-accent/15 text-2xs font-semibold text-accent">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function StatsCard({ data }: { data: WaStatus }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Stat
        icon={Inbox}
        label="Pendientes"
        value={String(data.pendientes)}
        accent={data.pendientes > 0 ? 'warn' : 'muted'}
      />
      <Stat
        icon={Clock}
        label="Último reporte"
        value={data.ultimoReporteEn ? formatDate(data.ultimoReporteEn) : '—'}
        small
      />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent = 'muted',
  small = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: 'warn' | 'muted';
  small?: boolean;
}) {
  return (
    <div className="vc-card p-3">
      <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-fg-subtle">
        <Icon className="size-3" />
        {label}
      </div>
      <div
        className={cn(
          'mt-1.5 truncate font-semibold tabular-nums',
          small ? 'text-xs text-fg-secondary' : 'text-2xl text-fg',
          accent === 'warn' && !small && 'text-warn',
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
