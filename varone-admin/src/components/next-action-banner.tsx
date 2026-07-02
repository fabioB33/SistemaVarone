/**
 * Sprint mejoras-flujo (2026-06-30) — Banner "¿Qué hago ahora?"
 *
 * Componente Server que se pone al top de cualquier página del panel.
 * Lee estado del sistema (counters + estado WA) y decide cuál es la
 * acción más urgente:
 *
 *  1. Si hay fallo_publicacion > 0: "N reportes fallaron → Corregir"
 *  2. Si hay pendiente > 0: "N reportes esperando aprobación → Revisar"
 *  3. Si bot desconectado: "Bot caído → Reconectar"
 *  4. Si nada urgente: "Todo al día ✓"
 *
 * Diseñado para reducir la carga cognitiva del operador solitario:
 * al entrar al panel a la mañana, sabe cuál es su primera acción.
 */

import Link from 'next/link';
import { AlertCircle, Inbox, CheckCircle2, MessageSquareOff, ArrowRight } from 'lucide-react';
import { obtenerDashboardCounters, obtenerWaStatus } from '@/lib/backend';

export async function NextActionBanner() {
  const [counters, wa] = await Promise.all([
    obtenerDashboardCounters(),
    obtenerWaStatus(),
  ]);

  const fallo = counters?.estados.falloPublicacion ?? 0;
  const pendiente = counters?.estados.pendientes ?? 0;
  const botCaido = wa?.status === 'disconnected';

  // Priorizar por criticidad
  if (fallo > 0) {
    return (
      <ActionCard
        icon={AlertCircle}
        color="danger"
        title={`${fallo} ${fallo === 1 ? 'reporte falló' : 'reportes fallaron'} al publicar`}
        subtitle="Requieren tu corrección para poder subirse al sitio público."
        href="/aprobacion?estado=fallo_publicacion"
        cta="Corregir errores"
      />
    );
  }

  if (botCaido) {
    return (
      <ActionCard
        icon={MessageSquareOff}
        color="warning"
        title="Bot WhatsApp desconectado"
        subtitle="No estás recibiendo mensajes del grupo. Reconectá escaneando el QR."
        href="/aprobacion?estado=pendiente"
        cta="Reconectar bot"
      />
    );
  }

  if (pendiente > 0) {
    return (
      <ActionCard
        icon={Inbox}
        color="amber"
        title={`${pendiente} ${pendiente === 1 ? 'reporte esperando' : 'reportes esperando'} aprobación`}
        subtitle={pendiente === 1 ? 'La IA lo clasificó, ahora te toca revisarlo.' : 'La IA los clasificó, ahora te toca revisarlos.'}
        href="/aprobacion?estado=pendiente"
        cta="Ir a aprobación"
      />
    );
  }

  return (
    <ActionCard
      icon={CheckCircle2}
      color="ok"
      title="Todo al día ✓"
      subtitle="Ningún reporte requiere tu acción por ahora. El sistema sigue escuchando."
    />
  );
}

interface ActionCardProps {
  icon: React.ComponentType<{ className?: string }>;
  color: 'danger' | 'warning' | 'amber' | 'ok';
  title: string;
  subtitle: string;
  href?: string;
  cta?: string;
}

const COLOR_MAP = {
  danger: {
    border: 'border-red-500/40',
    bg: 'bg-red-500/5',
    text: 'text-red-600 dark:text-red-400',
    button: 'bg-red-500 hover:bg-red-600 text-white',
  },
  warning: {
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/5',
    text: 'text-amber-600 dark:text-amber-400',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  amber: {
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/5',
    text: 'text-amber-600 dark:text-amber-400',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  ok: {
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    text: 'text-emerald-600 dark:text-emerald-400',
    button: '',
  },
} as const;

function ActionCard({ icon: Icon, color, title, subtitle, href, cta }: ActionCardProps) {
  const c = COLOR_MAP[color];
  return (
    <div
      className={`flex flex-wrap items-center gap-4 rounded-lg border ${c.border} ${c.bg} p-4 sm:p-5`}
    >
      <div className={`rounded-lg bg-bg-elevated p-2.5 ring-1 ring-border ${c.text}`}>
        <Icon className="size-5 sm:size-6" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-semibold text-fg sm:text-lg">{title}</h2>
        <p className="mt-0.5 text-xs text-fg-muted sm:text-sm">{subtitle}</p>
      </div>
      {href && cta && (
        <Link
          href={href}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-colors ${c.button}`}
        >
          {cta}
          <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
