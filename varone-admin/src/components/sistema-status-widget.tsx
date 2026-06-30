'use client';

/**
 * Sprint flujo-errores-editables (2026-06-30) — Widget consolidado de estado
 * del sistema en el topbar.
 *
 * Reemplaza los 3 badges sueltos (PublisherHealthBadge + ErroresPublicacionBadge
 * + AlertasBadge) por un solo bloque con labels visibles + counters claros.
 *
 * Indicadores:
 *  1. Publisher (verde / amber / rojo) — si el sitio público recibe noticias
 *  2. Alertas operativas no leídas — counter amber (Sprint hardening)
 *
 * Cleanup: ErroresPublicacionBadge se eliminó porque ya hay tab "Errores"
 * en /aprobacion con counter visible + acciones inline.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, GlobeLock, WifiOff, Bell, BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const POLL_HEALTH_MS = 60_000;
const POLL_ALERTAS_MS = 30_000;

type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unreachable' | 'loading';

interface HealthPayload {
  ok?: boolean;
  publisherStatus?: 'healthy' | 'degraded' | 'down' | 'unreachable';
  error?: string;
}

export function SistemaStatusWidget() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('loading');
  const [alertasCount, setAlertasCount] = useState(0);

  // Poll publisher health
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch('/api/publisher-health', { cache: 'no-store' });
        if (cancelled) return;
        const j = (await r.json()) as HealthPayload;
        setHealthStatus(j.publisherStatus || 'unreachable');
      } catch {
        if (cancelled) return;
        setHealthStatus('unreachable');
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_HEALTH_MS);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Poll alertas count
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch('/api/alertas/sin-leer/count', { cache: 'no-store' });
        if (cancelled) return;
        if (r.ok) {
          const j = (await r.json()) as { count?: number };
          setAlertasCount(j.count ?? 0);
        }
      } catch {
        // silencioso
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_ALERTAS_MS);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Mapeo UI publisher health
  const healthUi = (() => {
    switch (healthStatus) {
      case 'healthy':
        return { Icon: Globe, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Publicador OK', tooltip: 'El sitio público está recibiendo noticias correctamente' };
      case 'degraded':
        return { Icon: GlobeLock, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Sesión expirada', tooltip: 'Publicador activo pero sesión Framer vencida (re-loguea solo)' };
      case 'down':
        return { Icon: WifiOff, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Publicador caído', tooltip: 'Browser muerto — las aprobaciones quedan pendientes hasta que vuelva' };
      case 'unreachable':
        return { Icon: WifiOff, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Sin conexión', tooltip: 'El publisher no responde' };
      default:
        return { Icon: Globe, color: 'text-fg-muted', bg: 'bg-bg-elevated', label: 'Verificando…', tooltip: 'Chequeando estado' };
    }
  })();

  const HealthIcon = healthUi.Icon;
  const tieneAlertas = alertasCount > 0;

  return (
    <div className="flex items-center gap-2">
      {/* Publicador status */}
      <div
        aria-label={healthUi.tooltip}
        title={healthUi.tooltip}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium transition-colors',
          healthUi.color,
          healthUi.bg,
        )}
      >
        <HealthIcon className="size-3.5" />
        <span className="hidden sm:inline">{healthUi.label}</span>
      </div>

      {/* Alertas operativas */}
      <Link
        href="/alertas"
        aria-label={tieneAlertas ? `${alertasCount} alerta${alertasCount === 1 ? '' : 's'} operativa${alertasCount === 1 ? '' : 's'} sin leer` : 'Sin alertas operativas'}
        title={tieneAlertas ? `${alertasCount} alerta${alertasCount === 1 ? '' : 's'} sin leer` : 'Sin alertas operativas'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium transition-colors',
          tieneAlertas ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15' : 'bg-bg-elevated text-fg-muted hover:bg-bg-soft',
        )}
      >
        {tieneAlertas ? <Bell className={cn('size-3.5', 'animate-pulse-dot')} /> : <BellOff className="size-3.5" />}
        <span className="hidden sm:inline">
          {tieneAlertas ? `${alertasCount} alerta${alertasCount === 1 ? '' : 's'}` : 'Sin alertas'}
        </span>
      </Link>
    </div>
  );
}
