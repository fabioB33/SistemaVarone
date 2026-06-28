'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2, Send, AlertCircle, CheckCheck, Trash2, Undo2 } from 'lucide-react';
import {
  aprobarAction,
  descartarAction,
  despublicarAction,
  publicarSitioAction,
} from '@/app/(app)/aprobacion/actions';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';

/**
 * Sprint flow-unificado-aprobacion (2026-06-28): nuevo prop `disabledReason`.
 * Si está seteado, el botón "Aprobar" queda disabled + muestra tooltip
 * + leyenda chiquita debajo. Pattern: Varone NO puede aprobar reportes
 * con `camposFaltantes > 0` hasta completar los dropdowns en amber.
 */
export function AprobarButton({ id, disabledReason }: { id: number; disabledReason?: string | null }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const isDisabled = isPending || !!disabledReason;

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await aprobarAction(id);
            if (!r.ok) setErr(r.error || 'Error al aprobar');
            else router.refresh();
          })
        }
        disabled={isDisabled}
        title={disabledReason ?? undefined}
        className="vc-btn vc-btn-success vc-btn-sm"
        aria-label="Aprobar reporte"
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        Aprobar y publicar
      </button>
      {disabledReason && (
        <span className="flex items-center gap-1 text-2xs text-warn">
          <AlertCircle className="size-3" /> {disabledReason}
        </span>
      )}
      {err && (
        <span className="flex items-center gap-1 text-2xs text-danger">
          <AlertCircle className="size-3" /> {err}
        </span>
      )}
    </div>
  );
}

export function DescartarButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    setErr(null);
    start(async () => {
      const r = await descartarAction(id);
      if (!r.ok) {
        setErr(r.error || 'Error al descartar');
        setOpen(false);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="vc-btn vc-btn-danger vc-btn-sm"
        aria-label="Descartar reporte"
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
        Descartar
      </button>
      {err && (
        <span className="flex items-center gap-1 text-2xs text-danger">
          <AlertCircle className="size-3" /> {err}
        </span>
      )}

      <ConfirmDialog
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={handleConfirm}
        loading={isPending}
        tone="danger"
        icon={Trash2}
        title={`¿Descartar reporte #${id}?`}
        description={
          <>
            La noticia <strong className="font-medium text-fg">no llegará al sitio público</strong> y
            quedará registrada en la papelera. Esta acción se puede revertir desde la pestaña
            Descartados.
          </>
        }
        confirmLabel="Sí, descartar"
        cancelLabel="Cancelar"
      />
    </div>
  );
}

export function DespublicarButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    setErr(null);
    start(async () => {
      const r = await despublicarAction(id);
      if (!r.ok) {
        setErr(r.error || 'Error al despublicar');
        setOpen(false);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="vc-btn vc-btn-danger vc-btn-sm"
        aria-label="Despublicar reporte"
        title="Sacar esta nota del sitio público"
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        Despublicar
      </button>
      {err && (
        <span className="flex items-center gap-1 text-2xs text-danger">
          <AlertCircle className="size-3" /> {err}
        </span>
      )}

      <ConfirmDialog
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={handleConfirm}
        loading={isPending}
        tone="danger"
        icon={Undo2}
        title={`¿Despublicar reporte #${id}?`}
        description={
          <>
            La nota se va a <strong className="font-medium text-fg">borrar de Framer</strong> y el
            sitio público se va a re-publicar para que desaparezca. Esta acción es necesaria si la
            IA auto-publicó algo incorrecto. Queda registrado en el audit log.
          </>
        }
        confirmLabel="Sí, despublicar"
        cancelLabel="Cancelar"
      />
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
    <div className="flex flex-col items-stretch gap-1.5">
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
            setMsg(`Publicado · ${r.promovidos ?? 0} reportes promovidos`);
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
          'vc-btn vc-btn-md',
          disabled ? 'vc-btn-secondary' : 'vc-btn-primary',
        )}
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Publicando…
          </>
        ) : (
          <>
            <Send className="size-4" />
            <span>Publicar ahora</span>
            {pendientesPublicar > 0 && (
              <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-accent-fg/15 px-1.5 text-2xs font-semibold tabular-nums">
                {pendientesPublicar}
              </span>
            )}
          </>
        )}
      </button>
      {msg && (
        <span className="flex items-center gap-1.5 text-2xs text-ok animate-fade-in">
          <CheckCheck className="size-3" /> {msg}
        </span>
      )}
      {err && (
        <span className="flex items-center gap-1.5 text-2xs text-danger animate-fade-in">
          <AlertCircle className="size-3" /> {err}
        </span>
      )}
    </div>
  );
}
