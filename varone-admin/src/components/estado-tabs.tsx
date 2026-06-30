import Link from 'next/link';
import { Inbox, Loader2, Globe, AlertCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Sprint flow-claridad (2026-06-30): labels alineados con el flow real
// (post-pivot a Playwright). Antes los labels eran del flow viejo donde
// había un cron 9AM/21hs que publicaba el sitio. Hoy el publisher postea
// inmediato al aprobar.
//
//   pendiente            → Varone tiene que decidir
//   aprobado             → publisher trabajando (puede tardar 5-30s)
//   publicado            → llegó al sitio público
//   fallo_publicacion    → publisher falló, requiere acción
//   descartado           → terminal
export type Estado = 'pendiente' | 'aprobado' | 'publicado' | 'fallo_publicacion' | 'descartado';

interface TabDef {
  value: Estado;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Color de acento cuando el contador es > 0. */
  accent: 'warn' | 'info' | 'ok' | 'danger' | 'muted';
}

const TABS: readonly TabDef[] = [
  { value: 'pendiente',         label: 'Para aprobar',   hint: 'Varone decide: aprobar o descartar',  icon: Inbox,       accent: 'warn'   },
  { value: 'aprobado',          label: 'En publicación', hint: 'publisher Playwright trabajando',     icon: Loader2,     accent: 'info'   },
  { value: 'publicado',         label: 'Publicados',     hint: 'visibles en el sitio público',        icon: Globe,       accent: 'ok'     },
  { value: 'fallo_publicacion', label: 'Errores',        hint: 'publisher falló, requiere acción',    icon: AlertCircle, accent: 'danger' },
  { value: 'descartado',        label: 'Descartados',    hint: 'Varone NO los publicó',               icon: Trash2,      accent: 'muted'  },
];

interface Props {
  estado: Estado;
  counts?: Partial<Record<Estado, number>>;
}

export function EstadoTabs({ estado, counts }: Props) {
  return (
    <nav
      role="tablist"
      aria-label="Estado de los reportes"
      className="vc-card flex flex-wrap gap-1 p-1"
    >
      {TABS.map((tab) => {
        const active = tab.value === estado;
        const count = counts?.[tab.value];
        const Icon = tab.icon;
        const hasCount = typeof count === 'number';
        const showAccentCount = hasCount && count > 0 && !active;

        return (
          <Link
            key={tab.value}
            role="tab"
            aria-selected={active}
            href={`/aprobacion?estado=${tab.value}`}
            className={cn(
              'group relative flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 sm:flex-initial',
              active
                ? 'bg-accent text-accent-fg shadow-sm'
                : 'text-fg-muted hover:bg-subtle/60 hover:text-fg',
            )}
            title={tab.hint}
          >
            <Icon className={cn('size-4', active ? 'text-accent-fg' : 'text-fg-subtle group-hover:text-fg-muted')} />
            <span>{tab.label}</span>
            {hasCount && (
              <span
                className={cn(
                  'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
                  active && 'bg-accent-fg/15 text-accent-fg',
                  !active && count === 0 && 'bg-subtle/60 text-fg-subtle',
                  showAccentCount && tab.accent === 'warn' && 'bg-warn/15 text-warn',
                  showAccentCount && tab.accent === 'info' && 'bg-info/15 text-info',
                  showAccentCount && tab.accent === 'ok' && 'bg-ok/15 text-ok',
                  showAccentCount && tab.accent === 'danger' && 'bg-danger/15 text-danger',
                  showAccentCount && tab.accent === 'muted' && 'bg-subtle/60 text-fg-muted',
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
