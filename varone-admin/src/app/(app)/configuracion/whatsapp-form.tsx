'use client';

/**
 * Sprint admin-config (2026-06-30) — Form para editar el nombre del grupo WA.
 */

import { useState, useTransition } from 'react';
import { Save, Loader2, MessageSquareText, AlertTriangle } from 'lucide-react';
import { toast } from '@/components/toast-container';
import { guardarWaGroupNameAction } from './actions';

interface Props {
  initialGroupName: string;
  envDefault: string;
}

export function WhatsAppForm({ initialGroupName, envDefault }: Props) {
  const [pending, startTransition] = useTransition();
  const [groupName, setGroupName] = useState(initialGroupName);
  const [savedName, setSavedName] = useState(initialGroupName);

  const dirty = groupName !== savedName;

  function handleSave() {
    startTransition(async () => {
      const r = await guardarWaGroupNameAction(groupName);
      if (r.ok) {
        setSavedName(groupName);
        toast(
          'success',
          r.aviso || '✅ Grupo actualizado. Reiniciá el bot para aplicar.'
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
          <MessageSquareText className="size-4 text-emerald-500" />
          Grupo de WhatsApp
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Nombre exacto del grupo que el bot va a monitorear (con mayúsculas, tildes y espacios).
        </p>
      </header>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-fg">Nombre del grupo</span>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Piratería de Camiones"
            className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          />
        </label>

        {envDefault && envDefault !== savedName && (
          <p className="rounded-md border border-fg-muted/20 bg-bg-soft px-3 py-2 text-xs text-fg-muted">
            <strong className="font-semibold">Default del .env:</strong> {envDefault}
          </p>
        )}

        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>Importante:</strong> después de guardar, tenés que{' '}
              <strong>reiniciar el bot</strong> desde <code>/aprobacion</code> o
              re-escanear el QR para que tome el nombre nuevo. Sin restart, sigue
              escuchando el grupo viejo.
            </span>
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          {dirty && !pending && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Cambios sin guardar
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || pending || groupName.trim().length < 2}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar
          </button>
        </div>
      </div>
    </section>
  );
}
