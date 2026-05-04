'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X, Save, Loader2, AlertCircle, ImageIcon } from 'lucide-react';
import { editarAction } from '@/app/(app)/aprobacion/actions';
import { type ReporteListItem } from '@/lib/backend';
import { cn } from '@/lib/utils';

interface Props {
  reporte: ReporteListItem;
}

interface FormState {
  ubicacion: string;
  ruta: string;
  tipoIncidente: string;
  gravedad: string;
  fecha: string;
  hora: string;
  descripcion: string;
  vehiculo: string;
  patente: string;
  victimas: string;
  detenidos: string;
  urlNoticia: string;
  ogImageUrl: string;
}

function buildForm(r: ReporteListItem): FormState {
  return {
    ubicacion: r.ubicacion ?? '',
    ruta: r.ruta ?? '',
    tipoIncidente: r.tipoIncidente ?? '',
    gravedad: r.gravedad ?? '',
    fecha: r.fecha ?? '',
    hora: r.hora ?? '',
    descripcion: r.descripcion ?? '',
    vehiculo: '',
    patente: '',
    victimas: '',
    detenidos: '',
    urlNoticia: r.urlNoticia ?? '',
    ogImageUrl: r.ogImageUrl ?? '',
  };
}

function diffChanges(initial: FormState, current: FormState) {
  const cambios: Record<string, string | null> = {};
  (Object.keys(current) as (keyof FormState)[]).forEach((k) => {
    if (current[k] !== initial[k]) {
      const v = current[k].trim();
      cambios[k] = v === '' ? null : v;
    }
  });
  return cambios;
}

export function EditarReporteDialog({ reporte }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<FormState>(() => buildForm(reporte));
  const [form, setForm] = useState<FormState>(() => buildForm(reporte));
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  useEffect(() => {
    if (open) {
      const fresh = buildForm(reporte);
      setInitial(fresh);
      setForm(fresh);
      setError(null);
      // Lock scroll del body cuando el modal está abierto
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, reporte]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cambios = diffChanges(initial, form);
    if (Object.keys(cambios).length === 0) {
      setError('No hay cambios para guardar.');
      return;
    }
    setError(null);
    start(async () => {
      const r = await editarAction(reporte.id, cambios);
      if (!r.ok) {
        setError(r.error || 'Error al guardar');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const cambiosCount = Object.keys(diffChanges(initial, form)).length;
  const dirty = cambiosCount > 0;

  return (
    <>
      <button onClick={() => setOpen(true)} className="vc-btn vc-btn-secondary vc-btn-sm">
        <Pencil className="size-3.5" />
        Editar
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-canvas/80 p-0 backdrop-blur-sm sm:items-center sm:p-4 vc-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-dialog-title"
            className="relative w-full max-w-2xl overflow-hidden rounded-t-xl border border-line bg-elevated shadow-xl sm:rounded-xl vc-slide-up"
          >
            {/* Header */}
            <header className="flex items-center justify-between border-b border-line bg-subtle/40 px-6 py-4">
              <div className="min-w-0">
                <h2 id="edit-dialog-title" className="text-base font-semibold tracking-tight text-fg">
                  Editar reporte
                </h2>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                  <span className="font-mono text-fg-subtle">#{reporte.id}</span>
                  <span className="size-1 rounded-full bg-fg-subtle" />
                  Solo se puede editar mientras esté pendiente.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="vc-btn vc-btn-ghost p-2"
                aria-label="Cerrar diálogo"
              >
                <X className="size-4" />
              </button>
            </header>

            {/* Body */}
            <form onSubmit={onSubmit} className="max-h-[68vh] overflow-y-auto px-6 py-5" noValidate>
              <Section title="Ubicación e identificación">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Ubicación" required>
                    <input className="vc-input" value={form.ubicacion} onChange={(e) => update('ubicacion', e.target.value)} />
                  </Field>
                  <Field label="Ruta" required>
                    <input className="vc-input" value={form.ruta} onChange={(e) => update('ruta', e.target.value)} />
                  </Field>
                  <Field label="Tipo de incidente" required>
                    <input className="vc-input" value={form.tipoIncidente} onChange={(e) => update('tipoIncidente', e.target.value)} />
                  </Field>
                  <Field label="Gravedad">
                    <select className="vc-input" value={form.gravedad} onChange={(e) => update('gravedad', e.target.value)}>
                      <option value="">— sin definir</option>
                      <option value="alta">Alta</option>
                      <option value="media">Media</option>
                      <option value="baja">Baja</option>
                    </select>
                  </Field>
                  <Field label="Fecha (YYYY-MM-DD)" required>
                    <input className="vc-input" value={form.fecha} onChange={(e) => update('fecha', e.target.value)} placeholder="2026-05-03" />
                  </Field>
                  <Field label="Hora">
                    <input className="vc-input" value={form.hora} onChange={(e) => update('hora', e.target.value)} placeholder="14:30 o desconocida" />
                  </Field>
                </div>
              </Section>

              <Section title="Descripción">
                <Field label="Resumen del incidente" required>
                  <textarea
                    className="vc-input min-h-[120px] resize-y leading-relaxed"
                    value={form.descripcion}
                    onChange={(e) => update('descripcion', e.target.value)}
                  />
                </Field>
              </Section>

              <Section title="Detalles operativos" subtitle="Opcional — completá lo que sepas">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Vehículo"><input className="vc-input" value={form.vehiculo} onChange={(e) => update('vehiculo', e.target.value)} /></Field>
                  <Field label="Patente"><input className="vc-input" value={form.patente} onChange={(e) => update('patente', e.target.value)} /></Field>
                  <Field label="Víctimas"><input className="vc-input" value={form.victimas} onChange={(e) => update('victimas', e.target.value)} /></Field>
                  <Field label="Detenidos"><input className="vc-input" value={form.detenidos} onChange={(e) => update('detenidos', e.target.value)} /></Field>
                </div>
              </Section>

              <Section title="Multimedia">
                <div className="space-y-4">
                  <Field label="URL de la noticia">
                    <input className="vc-input" value={form.urlNoticia} onChange={(e) => update('urlNoticia', e.target.value)} placeholder="https://..." />
                  </Field>
                  <Field label="URL imagen (Open Graph)">
                    <div className="flex gap-3 sm:items-start">
                      <input className="vc-input flex-1" value={form.ogImageUrl} onChange={(e) => update('ogImageUrl', e.target.value)} placeholder="https://..." />
                      <ImagePreview src={form.ogImageUrl} />
                    </div>
                  </Field>
                </div>
              </Section>

              {error && (
                <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger animate-fade-in">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </form>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-3 border-t border-line bg-subtle/40 px-6 py-3">
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                {dirty ? (
                  <>
                    <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
                    {cambiosCount} cambio{cambiosCount === 1 ? '' : 's'} sin guardar
                  </>
                ) : (
                  <>
                    <span className="size-1.5 rounded-full bg-fg-subtle" />
                    Sin cambios
                  </>
                )}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="vc-btn vc-btn-secondary vc-btn-sm">
                  Cancelar
                </button>
                <button type="submit" onClick={onSubmit} disabled={isPending || !dirty} className="vc-btn vc-btn-primary vc-btn-sm">
                  {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Guardar cambios
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line py-5 first:pt-0 last:border-b-0 last:pb-0">
      <header className="mb-4">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="vc-label">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}

function ImagePreview({ src }: { src: string }) {
  if (!src) {
    return (
      <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-line bg-canvas">
        <ImageIcon className="size-5 text-fg-subtle" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Vista previa"
      className="size-16 shrink-0 rounded-lg border border-line object-cover"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}
