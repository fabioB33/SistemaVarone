'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  WifiOff,
  Smartphone,
  Clock,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import type { WaStatus } from '@/lib/backend';
import { cn, formatDate } from '@/lib/utils';

const POLL_FAST_MS = 3_000;     // status QR / desconectado: revisamos seguido
const POLL_SLOW_MS = 30_000;    // ya conectado: chequeo de salud cada 30s

export function WaStatusPanel() {
  const [data, setData] = useState<(WaStatus & { backendDown?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch('/api/wa/status', { cache: 'no-store' });
        if (!cancelled && r.ok) {
          const j = (await r.json()) as WaStatus & { backendDown?: boolean };
          setData(j);
        }
      } catch {
        // ignorar
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled) return;
      const interval = data?.status === 'connected' ? POLL_SLOW_MS : POLL_FAST_MS;
      timer = setTimeout(tick, interval);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // refreshKey en deps → fuerza re-iniciar polling cuando se aprieta refresh manual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <aside className="space-y-4">
      <Header onRefresh={() => setRefreshKey((k) => k + 1)} loading={loading} />
      <BackendDownAlert visible={!!data?.backendDown} />
      {data && !data.backendDown && (
        <>
          <StatusCard data={data} />
          {data.status === 'qr' && data.qr && <QrCard qr={data.qr} />}
          <StatsCard data={data} />
        </>
      )}
      {!data && !loading && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
          Sin datos del backend. ¿Está corriendo?
        </div>
      )}
    </aside>
  );
}

function Header({ onRefresh, loading }: { onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        Estado WhatsApp
      </h2>
      <button
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 px-2 py-1 text-[10px] text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
        title="Refrescar ahora"
      >
        <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
        Refrescar
      </button>
    </div>
  );
}

function BackendDownAlert({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-4">
      <div className="flex items-start gap-2">
        <WifiOff className="mt-0.5 size-4 shrink-0 text-red-400" />
        <div>
          <p className="text-sm font-medium text-red-200">Backend no responde</p>
          <p className="mt-1 text-xs text-red-300/70">
            El sistema Varone (puerto 3000) no está accesible. Revisá que esté corriendo.
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
      iconCls: 'text-emerald-400',
      ring: 'ring-emerald-500/20 bg-emerald-500/5',
      title: 'Conectado',
      pulse: 'bg-emerald-400',
      desc: data.groupName
        ? `Escuchando "${data.groupName}"`
        : 'Escuchando el grupo configurado',
    },
    qr: {
      icon: Smartphone,
      iconCls: 'text-amber-400',
      ring: 'ring-amber-500/20 bg-amber-500/5',
      title: 'Esperando vinculación',
      pulse: 'bg-amber-400',
      desc: 'Escaneá el QR desde WhatsApp para conectar el bot.',
    },
    disconnected: {
      icon: WifiOff,
      iconCls: 'text-red-400',
      ring: 'ring-red-500/20 bg-red-500/5',
      title: 'Desconectado',
      pulse: 'bg-red-400',
      desc: 'El bot no está recibiendo mensajes. Iniciá sesión escaneando el QR.',
    },
  } as const;

  const { icon: Icon, iconCls, ring, title, desc, pulse } = map[data.status];

  return (
    <div className={cn('rounded-xl border border-slate-800 p-4 ring-1', ring)}>
      <div className="flex items-start gap-3">
        <div className="relative mt-0.5">
          <Icon className={cn('size-5', iconCls)} />
          {data.status !== 'disconnected' && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-2 w-2 rounded-full',
                pulse,
                data.status === 'connected' && 'animate-pulse',
              )}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">{title}</p>
          <p className="mt-1 text-xs text-slate-400">{desc}</p>
          {data.groupName && data.status === 'connected' && (
            <p className="mt-2 text-[11px] text-slate-500">
              Grupo: <span className="font-mono text-slate-300">{data.groupName}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function QrCard({ qr }: { qr: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="mb-3 text-xs font-medium text-slate-400">Escaneá con WhatsApp</p>
      <div className="rounded-lg bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR de WhatsApp" className="block w-full" />
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-400">
        <li>Abrí WhatsApp en tu celular.</li>
        <li>
          Tocá <strong>⋮</strong> → <strong>Dispositivos vinculados</strong>.
        </li>
        <li>Tocá <strong>Vincular un dispositivo</strong> y apuntá la cámara al QR.</li>
      </ol>
      <p className="mt-2 text-[10px] text-slate-500">
        El QR expira cada ~60 s. Si no lo escaneás a tiempo, se genera otro automáticamente.
      </p>
    </div>
  );
}

function StatsCard({ data }: { data: WaStatus }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
          <Inbox className="size-3" /> Pendientes
        </div>
        <div className="mt-1 text-xl font-semibold text-slate-100">{data.pendientes}</div>
      </div>
      <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
          <Clock className="size-3" /> Último reporte
        </div>
        <div className="mt-1 truncate text-xs text-slate-200" title={data.ultimoReporteEn ?? ''}>
          {data.ultimoReporteEn ? formatDate(data.ultimoReporteEn) : '—'}
        </div>
      </div>
    </div>
  );
}

