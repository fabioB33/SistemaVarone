'use client';

/**
 * Sprint demo-readiness (2026-06-30) — Botón "Scrapear ahora".
 *
 * Dispara los 6 scrapers en paralelo (POST /api/scrapers/correr-todos) y
 * muestra un toast/banner con el resultado:
 *   "✅ 120 notas escaneadas. 3 pasaron al pipeline IA."
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Loader2 } from 'lucide-react';

interface CorrerTodosResponse {
  ok: boolean;
  error?: string;
  totalNotas?: number;
  totalEnviadosAlPipeline?: number;
}

interface Props {
  /**
   * Sprint mejoras-flujo (2026-06-30): número de portales activos en
   * /configuracion. Si 0, el botón queda disabled + tooltip explicativo.
   */
  portalesActivosCount?: number;
}

export function ScrapearAhoraButton({ portalesActivosCount = 6 }: Props = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resultado, setResultado] = useState<CorrerTodosResponse | null>(null);
  const sinPortales = portalesActivosCount === 0;

  function handleClick() {
    setResultado(null);
    startTransition(async () => {
      try {
        // Disparo paralelo: scrapers reales + demo-vivo inyecta uno garantizado.
        // El demo-vivo solo aplica en modo desarrollo / demo. En prod sin la env
        // var DEMO_INJECT_ENABLED=1, el backend retorna 404 / 503 y lo ignoramos.
        const [resScrapers, resDemo] = await Promise.all([
          fetch('/api/scrapers/correr-todos', { method: 'POST' }),
          fetch('/api/demo/inyectar-vivo', { method: 'POST' }).catch(() => null),
        ]);
        const data = (await resScrapers.json()) as CorrerTodosResponse;
        // Si el demo-vivo respondió OK, sumamos +1 al pipeline para que el
        // toast diga la verdad.
        if (resDemo && resDemo.ok) {
          data.totalEnviadosAlPipeline = (data.totalEnviadosAlPipeline ?? 0) + 1;
        }
        setResultado(data);
        // Refresh server components para que los counters se actualicen
        router.refresh();
        // Disparar evento custom para que counters animen
        window.dispatchEvent(new CustomEvent('varone:reportes-actualizado'));
        // Limpiar el banner después de 8s
        setTimeout(() => setResultado(null), 8000);
      } catch (e) {
        setResultado({ ok: false, error: e instanceof Error ? e.message : 'Error desconocido' });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleClick}
        disabled={pending || sinPortales}
        title={sinPortales ? 'No hay portales activos. Activá alguno en /configuracion' : undefined}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Scrapeando 6 portales…
          </>
        ) : (
          <>
            <Zap className="size-4" />
            Scrapear ahora
          </>
        )}
      </button>

      {resultado && resultado.ok && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          ✅ {resultado.totalNotas ?? 0} notas escaneadas ·{' '}
          {resultado.totalEnviadosAlPipeline ?? 0} pasaron al pipeline IA
        </div>
      )}
      {resultado && !resultado.ok && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          ❌ {resultado.error || 'Error scrapeando'}
        </div>
      )}
    </div>
  );
}
