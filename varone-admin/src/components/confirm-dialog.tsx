'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'danger' | 'warning' | 'neutral';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  /** Tono visual según severidad de la acción. */
  tone?: Tone;
  /** Título corto en el header. */
  title: string;
  /** Descripción del impacto, 1-2 oraciones. */
  description: React.ReactNode;
  /** Texto del botón de confirmación (default: "Confirmar"). */
  confirmLabel?: string;
  /** Texto del botón de cancelar (default: "Cancelar"). */
  cancelLabel?: string;
  /** Icono opcional override en el header. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Si true, el confirm muestra loader y los botones se deshabilitan. */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  tone = 'danger',
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  icon,
  loading = false,
}: ConfirmDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll mientras el dialog está abierto
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    // Foco automático en cancelar (acción menos destructiva por default)
    cancelBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, loading]);

  if (!open) return null;

  const toneCfg = {
    danger: {
      iconWrap: 'bg-danger/15 ring-danger/30',
      iconColor: 'text-danger',
      defaultIcon: Trash2,
      confirmBtn: 'bg-danger text-white hover:bg-danger/90',
      defaultConfirmLabel: 'Eliminar',
    },
    warning: {
      iconWrap: 'bg-warn/15 ring-warn/30',
      iconColor: 'text-warn',
      defaultIcon: AlertTriangle,
      confirmBtn: 'bg-warn text-warn-fg hover:bg-warn/90 text-canvas',
      defaultConfirmLabel: 'Continuar',
    },
    neutral: {
      iconWrap: 'bg-subtle ring-line',
      iconColor: 'text-fg-muted',
      defaultIcon: AlertTriangle,
      confirmBtn: 'bg-accent text-accent-fg hover:bg-accent-strong',
      defaultConfirmLabel: 'Confirmar',
    },
  } as const;

  const cfg = toneCfg[tone];
  const Icon = icon || cfg.defaultIcon;
  const finalConfirmLabel = confirmLabel || cfg.defaultConfirmLabel;

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget && !loading) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-canvas/80 p-0 backdrop-blur-sm sm:items-center sm:p-4 vc-fade-in"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="relative w-full max-w-md overflow-hidden rounded-t-xl border border-line bg-elevated shadow-xl sm:rounded-xl vc-slide-up"
      >
        {/* Close button (oculto durante loading) */}
        {!loading && (
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded-md p-1.5 text-fg-muted transition-colors hover:bg-subtle hover:text-fg"
            aria-label="Cerrar diálogo"
          >
            <X className="size-4" />
          </button>
        )}

        {/* Body */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex gap-4">
            <span
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-full ring-1',
                cfg.iconWrap,
              )}
            >
              <Icon className={cn('size-5', cfg.iconColor)} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2
                id="confirm-dialog-title"
                className="text-base font-semibold tracking-tight text-fg"
              >
                {title}
              </h2>
              <div
                id="confirm-dialog-description"
                className="mt-1.5 text-sm leading-relaxed text-fg-muted"
              >
                {description}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex justify-end gap-2 border-t border-line bg-subtle/40 px-6 py-3">
          <button
            ref={cancelBtnRef}
            onClick={onClose}
            disabled={loading}
            className="vc-btn vc-btn-secondary vc-btn-sm"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={loading}
            className={cn(
              'vc-btn vc-btn-sm font-medium shadow-sm transition-all',
              cfg.confirmBtn,
            )}
          >
            {loading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Procesando…
              </>
            ) : (
              <>
                <Icon className="size-3.5" />
                {finalConfirmLabel}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
