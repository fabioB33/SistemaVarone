'use client';

/**
 * Sprint pivot-framer-form (2026-06-26) — Badge en topbar.
 *
 * Imita el patrón de AlertasBadge. Pollea cada 30s al endpoint
 * /api/pendientes-revision/count (proxy del backend).
 *
 * Si hay reportes en pendiente_revision:
 *   - Icon AlertTriangle animado.
 *   - Burbuja amber con el número.
 * Si no:
 *   - Icon CircleCheck muted.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const POLL_MS = 30_000;

export function PendientesRevisionBadge() {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch('/api/pendientes-revision/count', { cache: 'no-store' });
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
