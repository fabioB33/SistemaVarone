import Link from 'next/link';
import { CheckCircle2, XCircle, AlertCircle, Inbox, Clock3, ArrowRight, Truck } from 'lucide-react';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_SISTEMA_VARONE_URL || 'http://127.0.0.1:3000';

interface QuickActionResponse {
  ok: boolean;
  error?: string;
  action?: 'aprobar' | 'descartar';
  id?: number;
  alreadyDone?: boolean;
  estado?: string;
  message?: string;
}

async function ejecutarQuickAction(token: string): Promise<QuickActionResponse> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/quick-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    return (await res.json()) as QuickActionResponse;
  } catch {
    return { ok: false, error: 'No se pudo conectar al servidor.' };
  }
}

export default async function QuickActionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await ejecutarQuickAction(token);

  const success = result.ok;
  const isApprove = result.action === 'aprobar';
  const alreadyDone = success && result.alreadyDone === true;

  const Icon = success
    ? alreadyDone
      ? Clock3
      : isApprove
        ? CheckCircle2
        : XCircle
    : AlertCircle;

  const eyebrow = success
    ? alreadyDone
      ? 'Ya estaba registrado'
      : isApprove
        ? 'Acción confirmada'
        : 'Acción confirmada'
    : 'No se pudo ejecutar';

  const title = success
    ? alreadyDone
      ? 'Sin cambios'
      : isApprove
        ? '¡Aprobado!'
        : 'Descartado'
    : 'Algo no salió bien';

  const description = success
    ? alreadyDone
      ? result.message || `El reporte ya estaba en estado "${result.estado}".`
      : isApprove
        ? `Reporte #${result.id} aprobado y enviado a Framer en modo borrador.`
        : `Reporte #${result.id} descartado. No se publica en el sitio.`
    : result.error || 'Error desconocido. Probá desde el panel.';

  const tone = success
    ? alreadyDone
      ? 'neutral'
      : isApprove
        ? 'success'
        : 'warning'
    : 'error';

  const toneCfg = {
    success: {
      iconWrap: 'bg-ok/15 ring-ok/30',
      iconColor: 'text-ok',
      badgeCls: 'bg-ok/15 text-ok ring-ok/30',
      glowCls: 'before:bg-ok/10',
    },
    warning: {
      iconWrap: 'bg-warn/15 ring-warn/30',
      iconColor: 'text-warn',
      badgeCls: 'bg-warn/15 text-warn ring-warn/30',
      glowCls: 'before:bg-warn/10',
    },
    neutral: {
      iconWrap: 'bg-subtle ring-line',
      iconColor: 'text-fg-muted',
      badgeCls: 'bg-subtle text-fg-muted ring-line',
      glowCls: 'before:bg-line/10',
    },
    error: {
      iconWrap: 'bg-danger/15 ring-danger/30',
      iconColor: 'text-danger',
      badgeCls: 'bg-danger/15 text-danger ring-danger/30',
      glowCls: 'before:bg-danger/10',
    },
  } as const;

  const cfg = toneCfg[tone];

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      {/* Brand mark superior */}
      <div className="absolute left-1/2 top-8 -translate-x-1/2">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-gradient-to-br from-accent to-accent-strong shadow-sm ring-1 ring-accent/30">
            <Truck className="size-4 text-accent-fg" strokeWidth={2.5} />
          </span>
          <span className="text-sm font-semibold tracking-tight text-fg">Varone</span>
        </div>
      </div>

      <article
        className={`relative w-full max-w-md overflow-hidden rounded-xl border border-line bg-elevated p-8 text-center shadow-xl
                    before:absolute before:inset-0 before:-z-10 before:rounded-xl before:opacity-60 before:blur-3xl ${cfg.glowCls}
                    animate-slide-up`}
      >
        <div
          className={`mx-auto grid size-16 place-items-center rounded-full ring-2 ${cfg.iconWrap}`}
        >
          <Icon className={`size-8 ${cfg.iconColor}`} strokeWidth={1.75} />
        </div>

        <p
          className={`mt-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-2xs font-semibold uppercase tracking-wider ring-1 ${cfg.badgeCls}`}
        >
          {eyebrow}
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{description}</p>

        {success && isApprove && !alreadyDone && (
          <div className="mt-5 rounded-lg border border-line bg-canvas/60 px-4 py-3 text-left">
            <p className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">
              Próximo paso
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
              Para que aparezca en <strong className="text-fg">pirateriadecamiones.com.ar</strong>,
              hacé <strong className="text-accent">Publicar Ahora</strong> desde el panel
              o esperá al cron diario de las 9 AM.
            </p>
          </div>
        )}

        <div className="mt-7 flex flex-col gap-2.5">
          <Link href="/aprobacion" className="vc-btn vc-btn-primary vc-btn-md w-full">
            <Inbox className="size-4" />
            Ir al panel
            <ArrowRight className="size-3.5" />
          </Link>
          {success && isApprove && (
            <Link
              href="/aprobacion?estado=aprobado"
              className="text-xs text-fg-muted transition-colors hover:text-fg"
            >
              Ver cola de aprobados →
            </Link>
          )}
        </div>
      </article>

      <footer className="absolute bottom-6 left-1/2 -translate-x-1/2 text-2xs uppercase tracking-[0.18em] text-fg-subtle">
        Pampa Labs · Sistema Varone
      </footer>
    </main>
  );
}

export const metadata = {
  title: 'Acción rápida — Varone',
};
