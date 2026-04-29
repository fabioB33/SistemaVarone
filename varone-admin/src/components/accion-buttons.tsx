'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2, Send } from 'lucide-react';
import { aprobarAction, descartarAction, publicarSitioAction } from '@/app/(app)/aprobacion/actions';
import { cn } from '@/lib/utils';

export function AprobarButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await aprobarAction(id);
            if (!r.ok) setErr(r.error || 'Error al aprobar');
            else router.refresh();
          })
        }
        disabled={isPending}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50',
        )}
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        Aprobar
      </button>
      {err && <span className="text-[10px] text-red-400">{err}</span>}
    </div>
  );
}

export function DescartarButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() =>
          start(async () => {
            if (!confirm('¿Descartar este reporte? No llegará al sitio.')) return;
            setErr(null);
            const r = await descartarAction(id);
            if (!r.ok) setErr(r.error || 'Error al descartar');
            else router.refresh();
          })
        }
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800/60 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
        Descartar
      </button>
      {err && <span className="text-[10px] text-red-400">{err}</span>}
    </div>
  );
}

export function PublicarSitioButton({ pendientesPublicar }: { pendientesPublicar: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const disabled = isPending || pendientesPublicar === 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() =>
          start(async () => {
            setErr(null);
            setMsg(null);
            const r = await publicarSitioAction();
            if (!r.ok) {
              setErr(r.error || 'Error al publicar');
              return;
            }
            setMsg(`✓ Publicado · ${r.promovidos ?? 0} reportes promovidos`);
            router.refresh();
          })
        }
        disabled={disabled}
        title={
          pendientesPublicar === 0
            ? 'No hay reportes aprobados pendientes de publicar'
            : `Publicar ahora ${pendientesPublicar} reporte(s) aprobado(s)`
        }
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition',
          disabled
            ? 'cursor-not-allowed border border-slate-800 bg-slate-900 text-slate-500'
            : 'bg-sky-500 text-sky-950 hover:bg-sky-400',
        )}
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Publicar ahora{pendientesPublicar > 0 && ` (${pendientesPublicar})`}
      </button>
      {msg && <span className="text-[11px] text-emerald-400">{msg}</span>}
      {err && <span className="text-[11px] text-red-400">{err}</span>}
    </div>
  );
}
