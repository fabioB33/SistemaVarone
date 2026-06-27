'use client';

/**
 * Sprint hardening 13-mejoras (2026-06-27) — Badge en topbar para fallos publicación.
 *
 * Espejo del PendientesRevisionBadge — pollea cada 30s + evento custom para
 * refresh inmediato post-Server Action.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const POLL_MS = 30_000;
export const ERRORES_PUBLICACION_REFRESH_EVENT = 'varone:errores-publicacion-refresh';

export function ErroresPublicacionBadge() {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      const r = await fetch('/api/errores-publicacion/count', { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as { count?: number };
        setCount(j.count ?? 0);
      }
    } catch {
      // backend caído u otro error transitorio — ignorar
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      await fetchCount();
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    }
    tick();

    function onRefresh() {
      void fetchCount();
    }
    window.addEventListener(ERRORES_PUBLICACION_REFRESH_EVENT, onRefresh);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(ERRORES_PUBLICACION_REFRESH_EVENT, onRefresh);
    };
  }, [fetchCount]);

  const tieneErrores = count > 0;
  const Icon = tieneErrores ? AlertCircle : ShieldCheck;

  return (
    <Link
      href="/errores-publicacion"
      aria-label={tieneErrores ? `${count} reportes con error de publicación` : 'Sin errores de publicación'}
      title={tieneErrores ? `${count} reportes con error de publicación` : 'Sin errores de publicación'}
      className={cn(
        'relative inline-flex items-center justify-center rounded-md p-2 transition-colors',
        tieneErrores
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-fg-muted hover:bg-subtle/60 hover:text-fg',
      )}
    >
      <Icon className={cn('size-4', tieneErrores && 'animate-pulse-dot')} />
      {loaded && tieneErrores && (
        <span
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-canvas"
          aria-hidden
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
