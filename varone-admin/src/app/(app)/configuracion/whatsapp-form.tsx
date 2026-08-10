'use client';

/**
 * Sprint admin-config (2026-06-30) — Form para editar el nombre del grupo WA.
 *
 * Fix 2026-08-07: dejó de ser un campo de texto libre. El cliente tenía que
 * transcribir el nombre del grupo carácter por carácter y una diferencia
 * invisible (una tilde) dejó el bot conectado pero sordo durante horas, sin
 * ninguna señal en el panel. Ahora, si el bot está conectado, se elige de la
 * lista real de grupos que ve la cuenta vinculada. El input de texto queda solo
 * como fallback para cuando el bot está desconectado y no hay lista que pedir.
 */

import { useState, useTransition, useEffect } from 'react';
import { Save, Loader2, MessageSquareText, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from '@/components/toast-container';
import { guardarWaGroupNameAction } from './actions';

interface Props {
  initialGroupName: string;
  envDefault: string;
}

interface GruposResp {
  ok: boolean;
  motivo?: 'desconectado' | 'error';
  error?: string;
  grupos: string[];
}

export function WhatsAppForm({ initialGroupName, envDefault }: Props) {
  const [pending, startTransition] = useTransition();
  const [groupName, setGroupName] = useState(initialGroupName);
  const [savedName, setSavedName] = useState(initialGroupName);

  const [grupos, setGrupos] = useState<string[] | null>(null);
  const [motivo, setMotivo] = useState<'desconectado' | 'error' | null>(null);
  const [cargandoGrupos, setCargandoGrupos] = useState(true);

  const dirty = groupName !== savedName;
  // Solo ofrecemos el desplegable si el backend devolvió grupos de verdad.
  const hayLista = Boolean(grupos && grupos.length > 0);
  // Si el valor guardado no está en la lista, lo dejamos como opción extra para
  // no borrarlo sin querer: que el usuario vea qué tiene configurado hoy.
  const opciones = hayLista
    ? Array.from(new Set([...(grupos as string[]), ...(savedName ? [savedName] : [])]))
    : [];

  async function cargarGrupos() {
    setCargandoGrupos(true);
    try {
      const res = await fetch('/api/wa/grupos', { cache: 'no-store' });
      const data = (await res.json()) as GruposResp;
      setGrupos(data.grupos ?? []);
      setMotivo(data.ok ? null : (data.motivo ?? 'error'));
    } catch {
      setGrupos([]);
      setMotivo('error');
    } finally {
      setCargandoGrupos(false);
    }
  }

  useEffect(() => {
    void cargarGrupos();
  }, []);

  function handleSave() {
    startTransition(async () => {
      const r = await guardarWaGroupNameAction(groupName);
      if (r.ok) {
        setSavedName(groupName);
        toast('success', r.aviso || '✅ Grupo actualizado. Ya aplica, no hace falta reiniciar.');
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
          Grupo que el bot va a monitorear. Elegilo de la lista para evitar errores de tipeo.
        </p>
      </header>

      <div className="space-y-3">
        <label className="block">
          <span className="flex items-center justify-between text-xs font-medium text-fg">
            Nombre del grupo
            <button
              type="button"
              onClick={() => void cargarGrupos()}
              disabled={cargandoGrupos}
              className="inline-flex items-center gap-1 text-xs font-normal text-fg-muted hover:text-fg disabled:opacity-50"
            >
              <RefreshCw className={`size-3 ${cargandoGrupos ? 'animate-spin' : ''}`} />
              Actualizar lista
            </button>
          </span>

          {hayLista ? (
            <select
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
            >
              {!opciones.includes(groupName) && (
                <option value={groupName}>{groupName || '— sin configurar —'}</option>
              )}
              {opciones.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Piratería de Camiones"
              className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
            />
          )}
        </label>

        {!cargandoGrupos && !hayLista && motivo === 'desconectado' && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                El bot está desconectado, así que no puedo traer la lista de grupos. Podés
                escribir el nombre a mano, pero conviene vincular el WhatsApp primero y
                elegirlo de la lista: el nombre tiene que coincidir con el grupo real.
              </span>
            </p>
          </div>
        )}

        {!cargandoGrupos && !hayLista && motivo === 'error' && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>No se pudo traer la lista de grupos. Probá &quot;Actualizar lista&quot;.</span>
            </p>
          </div>
        )}

        {envDefault && envDefault !== savedName && (
          <p className="rounded-md border border-fg-muted/20 bg-bg-soft px-3 py-2 text-xs text-fg-muted">
            <strong className="font-semibold">Default del .env:</strong> {envDefault}
          </p>
        )}

        <p className="rounded-md border border-fg-muted/20 bg-bg-soft px-3 py-2 text-xs text-fg-muted">
          El cambio aplica solo: no hace falta reiniciar el bot ni re-escanear el QR. La
          comparación ignora mayúsculas, tildes y espacios de más.
        </p>

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
