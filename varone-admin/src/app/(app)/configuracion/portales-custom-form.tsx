'use client';

/**
 * Sprint portales-custom (2026-07-06) — Form + lista de portales agregados
 * por Varone desde el panel.
 *
 * Flujo:
 *  1. Varone completa nombre + URL de la sección policial
 *  2. (Opcional) selectores CSS avanzados
 *  3. Click "Probar" → backend hace un scrape one-shot y muestra las
 *     primeras 5 notas encontradas (o warning si trae 0)
 *  4. Si el resultado es bueno → click "Agregar" → se persiste en DB
 *     y aparece en la lista superior
 *  5. La lista tiene toggle activo/inactivo + botón eliminar
 */

import { useState, useTransition } from 'react';
import {
  Plus,
  Loader2,
  Save,
  Play,
  Check,
  X as XIcon,
  Trash2,
  AlertTriangle,
  ExternalLink,
  Globe2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { PortalCustomItem, ProbarScraperResult } from '@/lib/backend';
import { toast } from '@/components/toast-container';
import {
  probarScraperCustomAction,
  crearPortalCustomAction,
  togglePortalCustomAction,
  eliminarPortalCustomAction,
} from './actions';

interface Props {
  initialCustoms: PortalCustomItem[];
}

export function PortalesCustomForm({ initialCustoms }: Props) {
  const [pending, startTransition] = useTransition();
  const [customs, setCustoms] = useState(initialCustoms);
  const [showForm, setShowForm] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  // Form state
  const [nombre, setNombre] = useState('');
  const [url, setUrl] = useState('');
  const [cardSelector, setCardSelector] = useState('');
  const [linkSelector, setLinkSelector] = useState('');
  const [titleSelector, setTitleSelector] = useState('');

  // Preview state
  const [preview, setPreview] = useState<ProbarScraperResult | null>(null);

  function resetForm() {
    setNombre('');
    setUrl('');
    setCardSelector('');
    setLinkSelector('');
    setTitleSelector('');
    setPreview(null);
    setAdvanced(false);
    setShowForm(false);
  }

  function handleProbar() {
    if (!url.trim()) {
      toast('error', 'La URL es requerida para probar');
      return;
    }
    startTransition(async () => {
      setPreview(null);
      const result = await probarScraperCustomAction({
        url: url.trim(),
        cardSelector: cardSelector.trim() || undefined,
        linkSelector: linkSelector.trim() || undefined,
        titleSelector: titleSelector.trim() || undefined,
      });
      setPreview(result);
      if (result.notasExtraidas > 0) {
        toast('success', `Probado OK — ${result.notasExtraidas} notas extraídas`);
      } else if (result.error) {
        toast('error', `Error: ${result.error}`);
      } else {
        toast('info', 'Probado — 0 notas extraídas. Revisá los selectores o el portal usa React.');
      }
    });
  }

  function handleAgregar() {
    if (!nombre.trim() || nombre.length < 2) {
      toast('error', 'Nombre requerido (mínimo 2 chars)');
      return;
    }
    if (!url.trim()) {
      toast('error', 'URL requerida');
      return;
    }
    startTransition(async () => {
      const r = await crearPortalCustomAction({
        nombre: nombre.trim(),
        url: url.trim(),
        cardSelector: cardSelector.trim() || undefined,
        linkSelector: linkSelector.trim() || undefined,
        titleSelector: titleSelector.trim() || undefined,
      });
      if (!r.ok) {
        toast('error', r.error || 'Error al agregar');
        return;
      }
      toast('success', `✅ Portal "${nombre}" agregado. El cron lo incluirá desde la próxima corrida.`);
      resetForm();
      // Trigger refresh
      window.location.reload();
    });
  }

  function handleToggle(id: number, activo: boolean) {
    startTransition(async () => {
      const r = await togglePortalCustomAction(id, activo);
      if (r.ok) {
        setCustoms((prev) => prev.map((p) => (p.id === id ? { ...p, activo } : p)));
        toast('success', activo ? 'Portal activado' : 'Portal desactivado');
      } else {
        toast('error', r.error || 'Error');
      }
    });
  }

  function handleEliminar(id: number, nombreP: string) {
    if (!confirm(`¿Eliminar el portal "${nombreP}"? Esta acción no se puede deshacer.`)) return;
    startTransition(async () => {
      const r = await eliminarPortalCustomAction(id);
      if (r.ok) {
        setCustoms((prev) => prev.filter((p) => p.id !== id));
        toast('success', 'Portal eliminado');
      } else {
        toast('error', r.error || 'Error');
      }
    });
  }

  return (
    <section className="rounded-lg border border-border bg-bg-elevated/50 p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <Globe2 className="size-4 text-emerald-500" />
            Portales agregados por vos
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Podés sumar portales policiales adicionales que quieras monitorear. El sistema
            los va a scrapear con la misma cadencia que los built-in (cada 15h).
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent/90"
          >
            <Plus className="size-3.5" />
            Agregar portal
          </button>
        )}
      </header>

      {/* Lista de portales custom existentes */}
      {customs.length === 0 && !showForm && (
        <div className="mb-4 rounded-md border border-dashed border-border bg-bg-elevated p-6 text-center text-sm text-fg-muted">
          Todavía no agregaste ningún portal. Click en "Agregar portal" para sumar uno.
        </div>
      )}

      {customs.length > 0 && (
        <div className="mb-4 space-y-2">
          {customs.map((portal) => (
            <div
              key={portal.id}
              className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                portal.activo
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-border bg-bg-elevated'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-fg">📰 {portal.nombre}</span>
                  <span className="rounded bg-fg-muted/10 px-1.5 py-0.5 font-mono text-2xs text-fg-muted">
                    {portal.slug}
                  </span>
                </div>
                <a
                  href={portal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
                >
                  <ExternalLink className="size-3" />
                  {portal.url}
                </a>
                {portal.ultimoScrapeOk && (
                  <p className="mt-1 text-2xs text-fg-muted">
                    Último scrape exitoso: {new Date(portal.ultimoScrapeOk).toLocaleDateString('es-AR')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleToggle(portal.id, !portal.activo)}
                  disabled={pending}
                  className={`grid size-8 place-items-center rounded-full ${
                    portal.activo
                      ? 'bg-emerald-500 text-white'
                      : 'bg-fg-muted/20 text-fg-muted'
                  }`}
                  aria-label={portal.activo ? 'Desactivar' : 'Activar'}
                  title={portal.activo ? 'Desactivar' : 'Activar'}
                >
                  {portal.activo ? <Check className="size-4" /> : <XIcon className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleEliminar(portal.id, portal.nombre)}
                  disabled={pending}
                  className="grid size-8 place-items-center rounded-full bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400"
                  aria-label="Eliminar"
                  title="Eliminar portal"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form para agregar nuevo */}
      {showForm && (
        <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 p-4">
          <h3 className="mb-3 text-sm font-semibold text-fg">Nuevo portal</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-fg">Nombre</span>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="ej. La Voz del Interior"
                className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg">URL de la sección policial</span>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.lavoz.com.ar/sucesos/"
                className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setAdvanced(!advanced)}
            className="mt-3 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          >
            {advanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Selectores CSS avanzados (opcional)
          </button>

          {advanced && (
            <div className="mt-2 grid gap-3 rounded border border-border/50 bg-bg-elevated/50 p-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-2xs font-medium text-fg">cardSelector</span>
                <p className="text-2xs text-fg-muted">Contenedor de cada nota</p>
                <input
                  type="text"
                  value={cardSelector}
                  onChange={(e) => setCardSelector(e.target.value)}
                  placeholder="article, .card, .news"
                  className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 font-mono text-2xs text-fg focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-2xs font-medium text-fg">linkSelector</span>
                <p className="text-2xs text-fg-muted">Anchor dentro del card</p>
                <input
                  type="text"
                  value={linkSelector}
                  onChange={(e) => setLinkSelector(e.target.value)}
                  placeholder="a[href*='/policiales/']"
                  className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 font-mono text-2xs text-fg focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-2xs font-medium text-fg">titleSelector</span>
                <p className="text-2xs text-fg-muted">Título del card</p>
                <input
                  type="text"
                  value={titleSelector}
                  onChange={(e) => setTitleSelector(e.target.value)}
                  placeholder="h2, h3, .title"
                  className="mt-1 block w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 font-mono text-2xs text-fg focus:border-accent focus:outline-none"
                />
              </label>
            </div>
          )}

          {/* Preview del test */}
          {preview && (
            <div
              className={`mt-3 rounded-md border p-3 text-xs ${
                preview.notasExtraidas > 0
                  ? 'border-emerald-500/40 bg-emerald-500/5 text-fg'
                  : 'border-amber-500/40 bg-amber-500/5 text-fg'
              }`}
            >
              {preview.error ? (
                <p className="flex items-start gap-2 text-red-600 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Error: {preview.error}
                </p>
              ) : (
                <>
                  <p className="font-semibold">
                    {preview.notasExtraidas > 0 ? '✅' : '⚠'} Cards matcheadas: {preview.cardsMatcheadas} · Notas extraídas: {preview.notasExtraidas}
                  </p>
                  {preview.primeras.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {preview.primeras.map((n, i) => (
                        <li key={i} className="truncate">
                          <span className="text-fg-muted">{i + 1}.</span> {n.titulo}
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.notasExtraidas === 0 && preview.cardsMatcheadas === 0 && (
                    <p className="mt-2 text-fg-muted">
                      El cardSelector no matcheó nada. ¿El portal usa React (SPA)? Los sitios que renderean con JS
                      no funcionan con este scraper genérico.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              disabled={pending}
              className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-soft hover:text-fg disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleProbar}
              disabled={pending || !url.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-bg-soft hover:text-fg disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Probar antes de guardar
            </button>
            <button
              type="button"
              onClick={handleAgregar}
              disabled={pending || !nombre.trim() || !url.trim() || !preview || preview.notasExtraidas === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50"
              title={
                !preview || preview.notasExtraidas === 0
                  ? 'Probá primero — solo se puede guardar si el test trajo >0 notas'
                  : 'Guardar portal'
              }
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Agregar portal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
