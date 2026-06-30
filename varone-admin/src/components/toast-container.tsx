'use client';

/**
 * Sprint sugerencias-extras (2026-06-30) — Toast container global.
 *
 * Escucha el evento custom `varone:toast` con detail = { tipo, mensaje } y
 * muestra un toast en la esquina inferior derecha durante 4s.
 *
 * Para disparar:
 *   window.dispatchEvent(new CustomEvent('varone:toast', {
 *     detail: { tipo: 'success', mensaje: 'Reporte aprobado y enviado al sitio público' }
 *   }));
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

type ToastTipo = 'success' | 'error' | 'info';

interface ToastEvento {
  id: number;
  tipo: ToastTipo;
  mensaje: string;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastEvento[]>([]);

  useEffect(() => {
    let nextId = 1;
    function onToast(e: Event) {
      const ce = e as CustomEvent<{ tipo?: ToastTipo; mensaje?: string }>;
      const tipo = ce.detail?.tipo ?? 'info';
      const mensaje = ce.detail?.mensaje ?? '';
      if (!mensaje) return;
      const id = nextId++;
      setToasts((curr) => [...curr, { id, tipo, mensaje }]);
      setTimeout(() => {
        setToasts((curr) => curr.filter((t) => t.id !== id));
      }, 4500);
    }
    window.addEventListener('varone:toast', onToast);
    return () => window.removeEventListener('varone:toast', onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => {
        const Icon = t.tipo === 'success' ? CheckCircle2 : t.tipo === 'error' ? AlertCircle : CheckCircle2;
        const colors =
          t.tipo === 'success'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : t.tipo === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
              : 'border-fg-muted/40 bg-bg-elevated text-fg';
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border ${colors} px-4 py-3 shadow-lg backdrop-blur-md animate-in slide-in-from-right`}
            style={{ minWidth: 260, maxWidth: 420 }}
          >
            <Icon className="mt-0.5 size-5 shrink-0" />
            <p className="flex-1 text-sm font-medium">{t.mensaje}</p>
            <button
              onClick={() => setToasts((curr) => curr.filter((x) => x.id !== t.id))}
              aria-label="Cerrar"
              className="opacity-60 hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Helper para dispararlo desde cualquier componente. */
export function toast(tipo: ToastTipo, mensaje: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('varone:toast', { detail: { tipo, mensaje } }));
}
