'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck, Loader2 } from 'lucide-react';
import { marcarVistaAction, marcarTodasAction } from './actions';

export function MarcarVistaButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  return (
    <button
      onClick={() =>
        start(async () => {
          await marcarVistaAction(id);
          router.refresh();
        })
      }
      disabled={isPending}
      className="vc-btn vc-btn-ghost vc-btn-sm"
      aria-label={`Marcar alerta #${id} como leída`}
    >
      {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      <span>Marcar leída</span>
    </button>
  );
}

export function MarcarTodasButton({ pendientes }: { pendientes: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  if (pendientes === 0) return null;
  return (
    <button
      onClick={() =>
        start(async () => {
          await marcarTodasAction();
          router.refresh();
        })
      }
      disabled={isPending}
      className="vc-btn vc-btn-secondary vc-btn-sm"
    >
      {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
      <span>Marcar las {pendientes} como leídas</span>
    </button>
  );
}
