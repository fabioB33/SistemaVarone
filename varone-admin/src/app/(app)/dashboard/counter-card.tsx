'use client';

/**
 * Sprint sugerencias-extras (2026-06-30) — Counter card animado.
 *
 * Recibe valor inicial del Server Component. Escucha el evento custom
 * `varone:reportes-actualizado` y refetcha el endpoint para actualizar el
 * número con animación bouncing (pulse + scale).
 *
 * Diseñado para que el "Scrapear ahora" se note: el counter pega un brinco
 * visible cuando entran reportes nuevos.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Props {
  initialValue: number;
  label: string;
  hint?: string;
  badgeColor?: 'amber' | 'emerald' | 'red' | 'fg-muted';
  href?: string;
  fetchValue?: () => Promise<number>;
}

const COLORS = {
  amber: 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
  emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  red: 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400',
  'fg-muted': 'border-border bg-bg-elevated text-fg',
};

export function CounterCard({ initialValue, label, hint, badgeColor = 'fg-muted', href, fetchValue }: Props) {
  const [value, setValue] = useState(initialValue);
  const [bouncing, setBouncing] = useState(false);

  useEffect(() => {
    async function refetch() {
      if (!fetchValue) return;
      try {
        const nuevoValor = await fetchValue();
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
  }, [value, fetchValue]);

  const content = (
    <article className={`rounded-lg border p-5 transition-transform ${COLORS[badgeColor]} ${bouncing ? 'animate-bounce-once' : ''}`}>
      <p className="text-2xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold transition-all ${bouncing ? 'scale-110' : 'scale-100'}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </article>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}
