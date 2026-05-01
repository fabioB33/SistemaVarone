import Link from 'next/link';
import { CheckCircle2, XCircle, AlertCircle, Inbox, Clock3 } from 'lucide-react';

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
    const data = (await res.json()) as QuickActionResponse;
    return data;
  } catch {
    return { ok: false, error: 'No se pudo conectar al servidor' };
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

  const title = success
    ? alreadyDone
      ? 'Ya estaba hecho'
      : isApprove
        ? '¡Aprobado!'
        : 'Descartado'
    : 'No se pudo ejecutar';

  const description = success
    ? alreadyDone
      ? result.message || `El reporte ya estaba en estado "${result.estado}".`
      : isApprove
        ? `Reporte #${result.id} aprobado y enviado a Framer (en draft).`
        : `Reporte #${result.id} descartado. No se publica.`
    : result.error || 'Error desconocido';

  const colorClass = success
    ? alreadyDone
      ? 'text-slate-400'
      : isApprove
        ? 'text-emerald-400'
        : 'text-amber-400'
    : 'text-red-400';

  const ringClass = success
    ? alreadyDone
      ? 'ring-slate-700/40 bg-slate-800/30'
      : isApprove
        ? 'ring-emerald-500/20 bg-emerald-500/5'
        : 'ring-amber-500/20 bg-amber-500/5'
    : 'ring-red-500/20 bg-red-500/5';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div
        className={`w-full max-w-md rounded-2xl border border-slate-800 p-8 text-center ring-1 ${ringClass}`}
      >
        <Icon className={`mx-auto size-16 ${colorClass}`} strokeWidth={1.5} />
        <h1 className="mt-4 text-2xl font-semibold text-slate-100">{title}</h1>
        <p className="mt-2 text-sm text-slate-300">{description}</p>

        {success && isApprove && !alreadyDone && (
          <p className="mt-4 rounded-md bg-slate-900/60 p-3 text-xs text-slate-400">
            Para que aparezca en pirateriadecamiones.com.ar, falta hacer{' '}
            <strong className="text-slate-200">Publicar Ahora</strong> desde el panel
            (o esperar al cron diario de las 9 AM).
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/aprobacion"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-white"
          >
            <Inbox className="size-4" />
            Ir al panel
          </Link>
          {success && isApprove && (
            <Link
              href="/aprobacion?estado=aprobado"
              className="text-xs text-slate-400 transition hover:text-slate-200"
            >
              Ver cola de aprobados →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Acción rápida — Varone Admin',
};
