'use client';

/**
 * Sprint hardening 13-mejoras (2026-06-27) — Badge en topbar para
 * healthcheck del framer-publisher v2.
 *
 * Estados:
 * - healthy (verde): browser vivo + sesión activa en pirateriadecamiones.com.ar
 * - degraded (amber): browser vivo pero sesión vencida (Varone tiene que re-loguear)
 * - down (rojo): browser muerto o publisher caído
 * - unreachable (rojo): backend NO pudo contactar al publisher
 *
 * Pollea cada 60s (los cambios de estado son raros, no hace falta más fino).
 */

import { useEffect, useState } from 'react';
import { Globe, GlobeLock, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const POLL_MS = 60_000;

type Status = 'healthy' | 'degraded' | 'down' | 'unreachable' | 'loading';

interface HealthPayload {
  ok?: boolean;
  publisherStatus?: 'healthy' | 'degraded' | 'down' | 'unreachable';
  error?: string;
}

export function PublisherHealthBadge() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch('/api/publisher-health', { cache: 'no-store' });
        if (cancelled) return;
        const j = (await r.json()) as HealthPayload;
        setStatus(j.publisherStatus || 'unreachable');
        setError(j.error || null);
      } catch (e) {
        if (cancelled) return;
        setStatus('unreachable');
        setError(e instanceof Error ? e.message : null);
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const ui = (() => {
    switch (status) {
      case 'healthy':
        return { Icon: Globe, color: 'text-emerald-500 hover:bg-emerald-500/10', label: 'Publisher activo + sesión en sitio público' };
      case 'degraded':
        return { Icon: GlobeLock, color: 'text-amber-500 hover:bg-amber-500/10', label: 'Publisher activo pero sesión Framer vencida — re-loguear pronto' };
      case 'down':
        return { Icon: WifiOff, color: 'text-red-500 hover:bg-red-500/10', label: 'Publisher arriba pero browser muerto' };
      case 'unreachable':
        return { Icon: WifiOff, color: 'text-red-500 hover:bg-red-500/10', label: `Publisher no responde${error ? ` (${error})` : ''}` };
      default:
        return { Icon: Wifi, color: 'text-fg-muted hover:bg-subtle/60', label: 'Verificando publisher…' };
    }
  })();

  const Icon = ui.Icon;
  const showDot = status === 'degraded' || status === 'down' || status === 'unreachable';

  return (
    <div
      aria-label={ui.label}
      title={ui.label}
      className={cn(
        'relative inline-flex items-center justify-center rounded-md p-2 transition-colors',
        ui.color,
      )}
    >
      <Icon className={cn('size-4', showDot && 'animate-pulse-dot')} />
      {showDot && (
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-current ring-2 ring-canvas" aria-hidden />
      )}
    </div>
  );
}
