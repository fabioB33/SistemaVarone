'use client';

/**
 * Fix 2026-08-13 — Toggle para apagar todas las notificaciones del sistema
 * a Varone por WhatsApp (alertas de infraestructura + reportes nuevos
 * pendientes de aprobar). Aplica instantáneo al tocar el switch, sin botón
 * "Guardar" separado — es un solo booleano, no tiene sentido pedir 2 clicks.
 */

import { useState, useTransition } from 'react';
import { BellOff, BellRing, Loader2 } from 'lucide-react';
import { toast } from '@/components/toast-container';
import { guardarNotificacionesActivasAction } from './actions';

interface Props {
  initialActivas: boolean;
}

export function NotificacionesForm({ initialActivas }: Props) {
  const [pending, startTransition] = useTransition();
  const [activas, setActivas] = useState(initialActivas);

  function handleToggle() {
    const nuevoValor = !activas;
    startTransition(async () => {
      const r = await guardarNotificacionesActivasAction(nuevoValor);
      if (r.ok) {
        setActivas(nuevoValor);
        toast(
          'success',
          nuevoValor
            ? '🔔 Notificaciones reactivadas. Vas a volver a recibir alertas y reportes por WhatsApp.'
            : '🔕 Notificaciones desactivadas. No vas a recibir más mensajes del sistema por WhatsApp hasta que las reactives.',
        );
      } else {
        toast('error', r.error || 'No se pudo guardar');
      }
    });
  }

  return (
    <section className="rounded-lg border border-border bg-bg-elevated/50 p-6">
      <header className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
          {activas ? (
            <BellRing className="size-4 text-emerald-500" />
          ) : (
            <BellOff className="size-4 text-fg-muted" />
          )}
          Notificaciones por WhatsApp
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Controla TODOS los mensajes que el sistema te manda por WhatsApp: alertas de
          desconexión, bot zombie, backups fallidos, y también los reportes nuevos pendientes
          de aprobar. Con las notificaciones apagadas, seguís pudiendo revisar y aprobar todo
          desde acá en el panel — solo dejás de recibir avisos en el celular.
        </p>
      </header>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-bg-soft px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-fg">
            {activas ? 'Notificaciones activas' : 'Notificaciones desactivadas'}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {activas
              ? 'Recibís todos los avisos y reportes nuevos por WhatsApp.'
              : 'No estás recibiendo nada por WhatsApp. El sistema sigue funcionando normal.'}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={activas}
          onClick={handleToggle}
          disabled={pending}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            activas ? 'bg-emerald-500' : 'bg-fg-muted/30'
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
              activas ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
          {pending && (
            <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-white" />
          )}
        </button>
      </div>
    </section>
  );
}
