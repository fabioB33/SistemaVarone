import Link from 'next/link';
import { Inbox, CheckCircle2, Globe, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Estado = 'pendiente' | 'aprobado' | 'publicado' | 'descartado';

interface TabDef {
  value: Estado;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Color de acento cuando el contador es > 0. */
  accent: 'warn' | 'info' | 'ok' | 'muted';
}

const TABS: readonly TabDef[] = [
  { value: 'pendiente',  label: 'Pendientes',  hint: 'esperando decisión',     icon: Inbox,        accent: 'warn'  },
  { value: 'aprobado',   label: 'Aprobados',   hint: 'cola para publicar',     icon: CheckCircle2, accent: 'info'  },
  { value: 'publicado',  label: 'Publicados',  hint: 'visibles en el sitio',   icon: Globe,        accent: 'ok'    },
  { value: 'descartado', label: 'Descartados', hint: 'papelera',               icon: Trash2,       accent: 'muted' },
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
