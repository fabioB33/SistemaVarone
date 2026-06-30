/**
 * Sprint sugerencias-extras (2026-06-30) — Filtro por fuente.
 *
 * Tabs: Todos / WhatsApp / Portales. Funciona con query string `?fuente=`
 * mientras preserva el filtro activo de `?estado=`.
 */

import Link from 'next/link';
import { MessageSquare, Globe2, Layers } from 'lucide-react';
import { type ReporteListItem } from '@/lib/backend';
import type { Estado } from './estado-tabs';

interface Props {
  estado: Estado;
  fuente: 'todos' | 'whatsapp' | 'scraping';
  itemsAll: ReporteListItem[];
}

const TABS = [
  { value: 'todos', label: 'Todos', icon: Layers },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { value: 'scraping', label: 'Portales', icon: Globe2 },
] as const;

export function FuenteFilter({ estado, fuente, itemsAll }: Props) {
  const counts = {
    todos: itemsAll.length,
    whatsapp: itemsAll.filter((i) => i.fuente === 'whatsapp').length,
    scraping: itemsAll.filter((i) => i.fuente === 'scraping').length,
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-2xs uppercase tracking-wide text-fg-muted">Fuente:</span>
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = fuente === t.value;
        const href = `/aprobacion?estado=${estado}&fuente=${t.value}`;
        return (
          <Link
            key={t.value}
            href={href}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              active
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-soft'
            }`}
          >
            <Icon className="size-3" />
            {t.label}
            <span className="text-fg-muted">({counts[t.value]})</span>
          </Link>
        );
      })}
    </div>
  );
}
