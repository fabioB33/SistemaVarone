import Link from 'next/link';
import { cn } from '@/lib/utils';

export type Estado = 'pendiente' | 'aprobado' | 'publicado' | 'descartado';

const TABS: { value: Estado; label: string; hint: string }[] = [
  { value: 'pendiente', label: 'Pendientes', hint: 'esperando decisión' },
  { value: 'aprobado', label: 'Aprobados', hint: 'en cola para publicar' },
  { value: 'publicado', label: 'Publicados', hint: 'visibles en el sitio' },
  { value: 'descartado', label: 'Descartados', hint: 'papelera' },
];

interface Props {
  estado: Estado;
  counts?: Partial<Record<Estado, number>>;
}

export function EstadoTabs({ estado, counts }: Props) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900/40 p-1">
      {TABS.map((t) => {
        const active = t.value === estado;
        const count = counts?.[t.value];
        return (
          <Link
            key={t.value}
            href={`/aprobacion?estado=${t.value}`}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
              active
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100',
            )}
            title={t.hint}
          >
            <span>{t.label}</span>
            {typeof count === 'number' && (
              <span
                className={cn(
                  'inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  active ? 'bg-slate-900/10 text-slate-900' : 'bg-slate-800 text-slate-300',
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
