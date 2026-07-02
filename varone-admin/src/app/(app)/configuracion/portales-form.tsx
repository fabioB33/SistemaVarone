'use client';

/**
 * Sprint admin-config (2026-06-30) — Form para activar/desactivar portales.
 */

import { useState, useTransition } from 'react';
import { Save, Loader2, Globe2, Check, X as XIcon } from 'lucide-react';
import { toast } from '@/components/toast-container';
import { guardarPortalesActivosAction } from './actions';

const PORTAL_LABELS: Record<string, string> = {
  'cronica': 'Crónica',
  'diario-popular': 'Diario Popular',
  'infobae': 'Infobae',
  'la-nacion': 'La Nación',
  'clarin': 'Clarín',
  'pagina12': 'Página 12',
};

const PORTAL_URLS: Record<string, string> = {
  'cronica': 'https://www.cronica.com.ar/seccion/policiales',
  'diario-popular': 'https://www.diariopopular.com.ar/policiales',
  'infobae': 'https://www.infobae.com/sociedad/policiales/',
  'la-nacion': 'https://www.lanacion.com.ar/seguridad/',
  'clarin': 'https://www.clarin.com/policiales/',
  'pagina12': 'https://www.pagina12.com.ar/secciones/sociedad',
};

interface Props {
  initialActivos: Record<string, boolean>;
  disponibles: string[];
}

export function PortalesForm({ initialActivos, disponibles }: Props) {
  const [pending, startTransition] = useTransition();
  const [activos, setActivos] = useState(initialActivos);
  const [dirty, setDirty] = useState(false);

  function toggle(portal: string) {
    setActivos((prev) => ({ ...prev, [portal]: !prev[portal] }));
    setDirty(true);
  }

  function handleSave() {
    startTransition(async () => {
      const r = await guardarPortalesActivosAction(activos);
      if (r.ok) {
        setDirty(false);
        toast('success', '✅ Portales guardados. El cron los tomará en la próxima corrida.');
      } else {
        toast('error', r.error || 'No se pudo guardar');
      }
    });
  }

  const activosCount = Object.values(activos).filter(Boolean).length;

  return (
    <section className="rounded-lg border border-border bg-bg-elevated/50 p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <Globe2 className="size-4 text-amber-500" />
            Portales del scraper
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Activá o desactivá cada portal. El cron corre cada 15h y solo scrapea los habilitados.
          </p>
        </div>
        <span className="rounded-full bg-fg-muted/10 px-3 py-1 text-xs font-semibold text-fg-muted">
          {activosCount}/{disponibles.length} activos
        </span>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        {disponibles.map((portal) => {
          const activo = activos[portal] ?? false;
          const label = PORTAL_LABELS[portal] || portal;
          const url = PORTAL_URLS[portal];
          return (
            <button
              key={portal}
              type="button"
              onClick={() => toggle(portal)}
              className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                activo
                  ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10'
                  : 'border-border bg-bg-elevated hover:bg-bg-soft'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-fg">📰 {label}</p>
                {url && (
                  <p className="mt-0.5 truncate text-2xs text-fg-muted">{url}</p>
                )}
              </div>
              <span
                className={`shrink-0 grid size-8 place-items-center rounded-full ${
                  activo
                    ? 'bg-emerald-500 text-white'
                    : 'bg-fg-muted/20 text-fg-muted'
                }`}
                aria-label={activo ? 'Activo' : 'Desactivado'}
              >
                {activo ? <Check className="size-4" /> : <XIcon className="size-4" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        {dirty && !pending && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Tenés cambios sin guardar
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || pending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Guardar cambios
        </button>
      </div>
    </section>
  );
}
