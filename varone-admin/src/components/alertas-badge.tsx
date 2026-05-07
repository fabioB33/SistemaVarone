'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';

const POLL_MS = 30_000;

/**
 * Badge en topbar que muestra el conteo de alertas sin leer.
 * Pollea cada 30s al endpoint /api/alertas/sin-leer/count.
 *
 * Si hay alertas sin leer:
 *   - Icon BellRing (animado).
 *   - Burbuja roja con el número.
 *   - Color de acento warn.
 *
 * Si no hay alertas:
 *   - Icon Bell normal.
 *   - Sin burbuja.
 *   - Color muted.
 */
export function AlertasBadge() {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch('/api/alertas/sin-leer/count', { cache: 'no-store' });
        if (cancelled) return;
        if (r.ok) {
          const j = (await r.json()) as { count?: number };
          setCount(j.count ?? 0);
        }
      } catch {
        // backend caído u otro error transitorio — ignorar
      } finally {
        if (!cancelled) {
          setLoaded(true);
          timer = setTimeout(tick, POLL_MS);
        }
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const hasUnread = count > 0;
  const Icon = hasUnread ? BellRing : Bell;

  return (
    <Link
      href="/alertas"
      aria-label={hasUnread ? `${count} alertas sin leer` : 'Sin alertas'}
      title={hasUnread ? `${count} alertas sin leer` : 'Sin alertas'}
      className={cn(
        'relative inline-flex items-center justify-center rounded-md p-2 transition-colors',
        hasUnread
          ? 'text-warn hover:bg-warn/10'
          : 'text-fg-muted hover:bg-subtle/60 hover:text-fg',
      )}
    >
      <Icon className={cn('size-4', hasUnread && 'animate-pulse-dot')} />
      {loaded && hasUnread && (
        <span
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-warn px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-canvas"
          aria-hidden
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
