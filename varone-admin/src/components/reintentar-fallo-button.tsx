'use client';

/**
 * Sprint flow-claridad (2026-06-30) — Botón inline "Reintentar publicación"
 * para cards en estado `fallo_publicacion` desde /aprobacion?estado=fallo_publicacion.
 *
 * Reusa la Server Action ya existente de /errores-publicacion/actions.ts
 * (DRY — la lógica de reset framerIntentos + enviarAFramer está allá).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { reintentarPublicacionAction } from '@/app/(app)/aprobacion/actions';
import { toast } from './toast-container';

export function ReintentarFalloButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await reintentarPublicacionAction(id);
            if (!r.ok) {
              setErr(r.error || 'No se pudo reintentar');
              toast('error', r.error || 'Error al reintentar publicación');
            } else {
              toast('info', 'Reintento en proceso...');
              router.refresh();
            }
          })
        }
        disabled={isPending}
        className="vc-btn vc-btn-primary vc-btn-sm"
        aria-label="Reintentar publicación al sitio"
        title="Reintenta postear este reporte al formulario público"
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        Reintentar publicación
      </button>
      {err && (
        <span className="flex items-center gap-1 text-2xs text-danger">
          <AlertCircle className="size-3" /> {err}
        </span>
      )}
    </div>
  );
}
