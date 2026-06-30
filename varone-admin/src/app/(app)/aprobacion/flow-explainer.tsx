/**
 * Sprint flow-claridad (2026-06-30) — Breadcrumb visual del flow de un reporte.
 *
 * Muestra dónde está cada noticia en el pipeline:
 *
 *   📥 Para aprobar (5)  →  ⏳ En publicación (1)  →  ✅ Publicados (12)
 *                              ↘ ⚠ Errores (2)        ↘ 🗑 Descartados (3)
 *
 * Ayuda a Varone a entender qué requiere acción y qué está esperando solo.
 */

import Link from 'next/link';
import { Inbox, Loader2, Globe, AlertCircle, Trash2, ArrowRight } from 'lucide-react';

interface Props {
  counts: {
    pendiente: number;
    aprobado: number;
    publicado: number;
    fallo_publicacion: number;
    descartado: number;
  };
}

export function FlowExplainer({ counts }: Props) {
  return (
    <div className="vc-card flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
      <span className="text-2xs uppercase tracking-wide text-fg-muted">Flujo:</span>

      {/* Para aprobar — acción humana */}
      <Step
        href="/aprobacion?estado=pendiente"
        icon={Inbox}
        label="Para aprobar"
        count={counts.pendiente}
        color="warn"
      />

      <ArrowRight className="size-3 text-fg-subtle" />

      {/* En publicación */}
      <Step
        href="/aprobacion?estado=aprobado"
        icon={Loader2}
        label="En publicación"
        count={counts.aprobado}
        color="info"
      />

      <ArrowRight className="size-3 text-fg-subtle" />

      {/* Publicados — éxito final */}
      <Step
        href="/aprobacion?estado=publicado"
        icon={Globe}
        label="Publicados"
        count={counts.publicado}
        color="ok"
      />

      {/* Errores — alternativa de "en publicación" */}
      {counts.fallo_publicacion > 0 && (
        <>
          <span className="mx-1 text-fg-subtle">o</span>
          <Step
            href="/aprobacion?estado=fallo_publicacion"
            icon={AlertCircle}
            label="Errores"
            count={counts.fallo_publicacion}
            color="danger"
          />
        </>
      )}

      <span className="mx-2 text-fg-subtle">·</span>

      {/* Descartados — terminal alternativo desde el inicio */}
      <Step
        href="/aprobacion?estado=descartado"
        icon={Trash2}
        label="Descartados"
        count={counts.descartado}
        color="muted"
      />
    </div>
  );
}

interface StepProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  color: 'warn' | 'info' | 'ok' | 'danger' | 'muted';
}

const COLOR_MAP = {
  warn:   'text-amber-600 dark:text-amber-400',
  info:   'text-info',
  ok:     'text-emerald-500',
  danger: 'text-red-500',
  muted:  'text-fg-muted',
} as const;

function Step({ href, icon: Icon, label, count, color }: StepProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-subtle/40 ${COLOR_MAP[color]}`}
    >
      <Icon className="size-3.5" />
      <span className="font-medium">{label}</span>
      <span className="rounded-full bg-current/15 px-1.5 text-2xs font-semibold tabular-nums">
        {count}
      </span>
    </Link>
  );
}
