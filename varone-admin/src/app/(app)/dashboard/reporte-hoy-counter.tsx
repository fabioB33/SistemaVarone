'use client';

/**
 * Sprint sugerencias-extras (2026-06-30) — Counter "Reportes hoy" animado.
 *
 * Wrapper específico para el counter de hoy. Refetch automático al evento
 * `varone:reportes-actualizado` con efecto bounce + scale.
 */

import { useEffect, useState } from 'react';

interface Props {
  initialValue: number;
}

export function ReporteHoyCounter({ initialValue }: Props) {
  const [value, setValue] = useState(initialValue);
  const [bouncing, setBouncing] = useState(false);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    async function refetch() {
      try {
        const r = await fetch('/api/dashboard/counters', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { actividad?: { reportesHoy?: number } };
        const nuevoValor = j.actividad?.reportesHoy ?? value;
        if (nuevoValor !== value) {
          setBouncing(true);
          setValue(nuevoValor);
          setTimeout(() => setBouncing(false), 800);
        }
      } catch {
        // silencioso
      }
    }
    function onUpdate() {
      void refetch();
    }
    window.addEventListener('varone:reportes-actualizado', onUpdate);
    return () => window.removeEventListener('varone:reportes-actualizado', onUpdate);
  }, [value]);

  return (
    <article
      className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 transition-transform ${
        bouncing ? 'animate-bounce-once' : ''
      }`}
    >
      <p className="text-2xs uppercase tracking-wide text-fg-muted">Reportes hoy</p>
      <p
        className={`mt-1 text-3xl font-bold text-amber-600 transition-transform dark:text-amber-400 ${
          bouncing ? 'scale-110' : 'scale-100'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-fg-muted">desde 00:00</p>
    </article>
  );
}
