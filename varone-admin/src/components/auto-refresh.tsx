'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const DEFAULT_INTERVAL_MS = 15_000;

interface Props {
  /** Intervalo entre refresh, en milisegundos. Default 15s. */
  intervalMs?: number;
}

/**
 * Refresca los Server Components cada `intervalMs` mientras la pestaña esté
 * visible. Pausa cuando la pestaña no está activa para no consumir cuota
 * innecesaria del backend, y dispara un refresh inmediato al volver.
 */
export function AutoRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: Props) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          router.refresh();
        }
      }, intervalMs);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        router.refresh();
        start();
      } else {
        stop();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [router, intervalMs]);

  return null;
}
