'use client';

/**
 * Sprint 2026-07-07 — Análisis manual de URL.
 * Extendido 2026-08-13 — texto libre + carga forzada.
 *
 * Botón "Agregar noticia" que abre un dialog con 2 modos:
 *  - URL: pegar el link de una nota. El backend hace fetch + prefiltro + IA + dedup.
 *  - Texto: pegar el texto del mensaje de WhatsApp (con o sin link embebido).
 *
 * Motivación de la extensión: Varone reportó que 2 noticias aparecieron en
 * el grupo de WhatsApp y el bot no las procesó (rate-limit de la IA,
 * pre-filtro léxico, o la IA las descartó como "no relevantes"). Reintentar
 * por el mismo pipeline puede volver a descartarlas por el mismo motivo —
 * por eso el checkbox "Forzar carga": crea el reporte directo en pendientes
 * sin pasar por la IA, y Varone completa a mano los dropdowns que falten
 * desde la card de /aprobacion (mismo mecanismo que ya existe para reportes
 * con `camposFaltantes`).
 *
 * Cierra el gap arquitectural del scraper (sólo lee la portada del portal,
 * notas fuera del top se pierden) Y el gap del bot en vivo (mensajes que
 * nunca llegaron a generar un reporte, sin dejar rastro visible en el panel).
 */

import { useState, useTransition } from 'react';
import { LinkIcon, Loader2, MessageSquarePlus, Sparkles, X, Zap } from 'lucide-react';
import { analizarUrlAction, analizarTextoAction, reportarManualAction } from './actions';

type Modo = 'url' | 'texto';

type Feedback =
  | { kind: 'ok'; message: string }
  | { kind: 'dup'; message: string; id: number; estado: string }
  | { kind: 'err'; message: string };

export function AnalizarUrlDialog() {
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<Modo>('url');
  const [url, setUrl] = useState('');
  const [texto, setTexto] = useState('');
  const [forzar, setForzar] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setUrl('');
    setTexto('');
    setForzar(false);
    setFeedback(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    // Delay reset para que la animación de salida no muestre el estado limpio.
    setTimeout(reset, 200);
  }

  // Texto que se guardaría si se fuerza la carga: en modo texto, lo escrito;
  // en modo URL, el texto opcional que el usuario haya agregado o, a falta
  // de eso, la URL misma (mejor que nada, pero se avisa en el placeholder
  // que conviene pegar el texto real).
  const textoForzado = modo === 'texto' ? texto : texto || url;
  const textoForzadoValido = textoForzado.trim().length >= 15;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);

    startTransition(async () => {
      // Forzar carga: siempre crea el reporte, sin pasar por IA. Válido en
      // ambos modos — en modo URL, la URL se guarda como referencia pero el
      // texto es lo que se analiza (si el usuario no escribió texto propio
      // en modo URL, no hay forzado posible: no hay contenido que guardar
      // sin pasar por la IA a buscarlo).
      if (forzar) {
        if (!textoForzadoValido) {
          setFeedback({
            kind: 'err',
            message: 'Para forzar la carga necesito el texto de la noticia (al menos 15 caracteres), no solo el link.',
          });
          return;
        }
        const result = await reportarManualAction(textoForzado, modo === 'url' ? url : undefined);
        if (!result.ok) {
          setFeedback({ kind: 'err', message: result.error || 'Error desconocido' });
          return;
        }
        setFeedback({ kind: 'ok', message: result.mensaje || 'Reporte creado en pendientes.' });
        setTexto('');
        setUrl('');
        return;
      }

      // Modo normal: pasa por el pipeline con IA.
      const result = modo === 'url'
        ? await analizarUrlAction(url)
        : await analizarTextoAction(texto);

      if (!result.ok) {
        setFeedback({ kind: 'err', message: result.error || 'Error desconocido' });
        return;
      }
      if (result.duplicado && result.reporte) {
        setFeedback({
          kind: 'dup',
          message: result.mensaje || 'Ya estaba procesada',
          id: result.reporte.id,
          estado: result.reporte.estado,
        });
        return;
      }
      setFeedback({
        kind: 'ok',
        message: result.mensaje || 'Encolado. Refrescá en 10-30 segundos.',
      });
      setUrl('');
      setTexto('');
    });
  }

  // Condición de habilitación del submit, unificada en una sola variable
  // para no repetir la lógica de "qué hace falta" en el botón.
  const puedeEnviar = forzar
    ? textoForzadoValido
    : modo === 'url'
      ? url.trim().length > 0
      : texto.trim().length >= 15;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-subtle/40 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-line-strong hover:bg-subtle"
      >
        <MessageSquarePlus className="size-3.5 text-accent" />
        Agregar noticia
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
                  Carga manual
                </p>
                <h2 className="text-lg font-semibold text-fg">Agregar noticia</h2>
                <p className="mt-1 text-xs text-fg-muted">
                  Para noticias que viste en el grupo de WhatsApp pero el bot no cargó.
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

            {/* Tabs URL / Texto */}
            <div className="mt-4 flex gap-1 rounded-md border border-line bg-subtle/30 p-1">
              <button
                type="button"
                onClick={() => { setModo('url'); setFeedback(null); }}
                disabled={pending}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  modo === 'url' ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
                }`}
              >
                <LinkIcon className="size-3.5" />
                Link
              </button>
              <button
                type="button"
                onClick={() => { setModo('texto'); setFeedback(null); }}
                disabled={pending}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  modo === 'texto' ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
                }`}
              >
                <MessageSquarePlus className="size-3.5" />
                Texto
              </button>
            </div>

            <form onSubmit={submit} className="mt-4 space-y-3">
              {modo === 'url' ? (
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
                    required={!forzar}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={pending}
                    placeholder="https://www.infobae.com/..."
                    className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-50"
                    autoFocus
                  />
                  {forzar && (
                    <p className="mt-1.5 text-2xs text-fg-muted">
                      Si vas a forzar la carga, pegá también el texto de la noticia abajo (el link solo, sin
                      texto, no alcanza para crear el reporte sin pasar por IA).
                    </p>
                  )}
                  {forzar && (
                    <textarea
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      disabled={pending}
                      rows={3}
                      placeholder="Pegá acá el texto del mensaje de WhatsApp o el resumen de la noticia..."
                      className="mt-2 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                  )}
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="texto-analizar"
                    className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-fg-muted"
                  >
                    Texto de la noticia
                  </label>
                  <textarea
                    id="texto-analizar"
                    required
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    disabled={pending}
                    rows={5}
                    placeholder="Pegá acá el texto del mensaje del grupo de WhatsApp..."
                    className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-50"
                    autoFocus
                  />
                </div>
              )}

              <p className="text-xs text-fg-muted">
                {forzar
                  ? 'El sistema descarga el contenido, lo clasifica con IA y —si es relevante— aparece en pendientes.'
                  : 'Crea el reporte directo en pendientes, sin pasar por IA. Completá a mano los campos que falten desde la card.'}
              </p>

              {/* Toggle forzar */}
              <label className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={forzar}
                  onChange={(e) => setForzar(e.target.checked)}
                  disabled={pending}
                  className="mt-0.5 size-3.5 accent-amber-500"
                />
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Zap className="size-3" />
                    Forzar carga (saltear IA)
                  </span>
                  <br />
                  Usalo si ya intentaste con este link/texto y no apareció en pendientes — la IA
                  puede haberla descartado por error. Crea el reporte igual, con los campos que
                  falten marcados para completar a mano.
                </span>
              </label>

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
                  disabled={pending || !puedeEnviar}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 ${
                    forzar ? 'bg-amber-600 hover:bg-amber-600/90' : 'bg-accent hover:bg-accent/90'
                  }`}
                >
                  {pending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      {forzar ? 'Creando…' : 'Analizando…'}
                    </>
                  ) : forzar ? (
                    <>
                      <Zap className="size-3.5" />
                      Forzar carga
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
