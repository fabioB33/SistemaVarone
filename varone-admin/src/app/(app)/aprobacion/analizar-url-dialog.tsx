'use client';

/**
 * Sprint 2026-07-07 — Análisis manual de URL.
 *
 * Botón "Analizar URL" en el header de /aprobacion que abre un dialog para
 * pegar una URL. El backend hace fetch + prefiltro + IA + dedup igual que en
 * el flujo de scraper de portales.
 *
 * Cierra el gap arquitectural del scraper cron: sólo lee la portada del
 * portal (~20 notas), así que notas fuera del top se pierden. Con este flow
 * Varone puede sumar cualquier URL puntual.
 */

import { useState, useTransition } from 'react';
import { LinkIcon, Loader2, Sparkles, X } from 'lucide-react';
import { analizarUrlAction } from './actions';

export function AnalizarUrlDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [feedback, setFeedback] = useState<
    | { kind: 'ok'; message: string }
    | { kind: 'dup'; message: string; id: number; estado: string }
    | { kind: 'err'; message: string }
    | null
  >(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setUrl('');
    setFeedback(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    // Delay reset para que la animación de salida no muestre el estado limpio.
    setTimeout(reset, 200);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await analizarUrlAction(url);
      if (!result.ok) {
        setFeedback({ kind: 'err', message: result.error || 'Error desconocido' });
        return;
      }
      if (result.duplicado && result.reporte) {
        setFeedback({
          kind: 'dup',
          message: result.mensaje || 'La URL ya estaba procesada',
          id: result.reporte.id,
          estado: result.reporte.estado,
        });
        return;
      }
      setFeedback({
        kind: 'ok',
        message: result.mensaje || 'URL encolada. Refrescá en 10-30 segundos.',
      });
      setUrl('');
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-subtle/40 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-line-strong hover:bg-subtle"
      >
        <LinkIcon className="size-3.5 text-accent" />
        Analizar URL
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="vc-card w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="mb-1 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
                  <Sparkles className="size-3 text-accent" />
                  Análisis manual
                </p>
                <h2 className="text-lg font-semibold text-fg">Analizar URL</h2>
                <p className="mt-1 text-xs text-fg-muted">
                  Pegá el link de una nota policial. El sistema descarga el contenido,
                  lo clasifica con IA y —si es relevante— aparece en pendientes.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-subtle hover:text-fg disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={submit} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="url-analizar"
                  className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-fg-muted"
                >
                  URL de la nota
                </label>
                <input
                  id="url-analizar"
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={pending}
                  placeholder="https://www.infobae.com/..."
                  className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-50"
                  autoFocus
                />
              </div>

              {feedback && (
                <div
                  className={`rounded-md border p-3 text-xs ${
                    feedback.kind === 'ok'
                      ? 'border-ok/40 bg-ok/5 text-ok'
                      : feedback.kind === 'dup'
                        ? 'border-warn/40 bg-warn/5 text-warn'
                        : 'border-danger/40 bg-danger/5 text-danger'
                  }`}
                >
                  {feedback.message}
                  {feedback.kind === 'dup' && (
                    <div className="mt-1 text-fg-muted">
                      Reporte #{feedback.id} — estado: {feedback.estado}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-50"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={pending || !url.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                >
                  {pending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Analizando…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                      Analizar
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
