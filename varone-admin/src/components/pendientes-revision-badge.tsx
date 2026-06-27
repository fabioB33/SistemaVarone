'use client';

/**
 * Sprint pivot-framer-form (2026-06-26) — Badge en topbar.
 * Sprint hardening 13-mejoras (2026-06-27) — refresh inmediato post-acción.
 *
 * Pollea cada 30s al endpoint /api/pendientes-revision/count (proxy del backend).
 * Además escucha el evento custom `varone:pendientes-revision-refresh` para
 * actualizarse inmediatamente cuando una Server Action completa/descarta un
 * reporte. Sin esto, el badge tardaba hasta 30s en reflejar el cambio.
 *
 * Para disparar el refresh desde otro componente:
 *   window.dispatchEvent(new CustomEvent('varone:pendientes-revision-refresh'));
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const POLL_MS = 30_000;
export const PENDIENTES_REVISION_REFRESH_EVENT = 'varone:pendientes-revision-refresh';

export function PendientesRevisionBadge() {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      const r = await fetch('/api/pendientes-revision/count', { cache: 'no-store' });
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

    // Sprint hardening 13-mejoras: refresh inmediato cuando alguien completa/descarta.
    function onRefresh() {
      void fetchCount();
    }
    window.addEventListener(PENDIENTES_REVISION_REFRESH_EVENT, onRefresh);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(PENDIENTES_REVISION_REFRESH_EVENT, onRefresh);
    };
  }, [fetchCount]);

  const tienePendientes = count > 0;
  const Icon = tienePendientes ? AlertTriangle : CircleCheck;

  return (
    <Link
      href="/pendientes-revision"
      aria-label={tienePendientes ? `${count} reportes pendientes de revisión` : 'Sin pendientes de revisión'}
      title={tienePendientes ? `${count} reportes pendientes de revisión` : 'Sin pendientes de revisión'}
      className={cn(
        'relative inline-flex items-center justify-center rounded-md p-2 transition-colors',
        tienePendientes
          ? 'text-amber-500 hover:bg-amber-500/10'
          : 'text-fg-muted hover:bg-subtle/60 hover:text-fg',
      )}
    >
      <Icon className={cn('size-4', tienePendientes && 'animate-pulse-dot')} />
      {loaded && tienePendientes && (
        <span
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-canvas"
          aria-hidden
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
