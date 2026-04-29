'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X, Save, Loader2 } from 'lucide-react';
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
    }
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
      setError('Sin cambios');
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

  const dirty = Object.keys(diffChanges(initial, form)).length > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800/60"
      >
        <Pencil className="size-3.5" />
        Editar
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Editar reporte #{reporte.id}</h2>
                <p className="text-xs text-slate-500">
                  Solo se puede editar mientras esté pendiente.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                aria-label="Cerrar"
              >
                <X className="size-4" />
              </button>
            </header>

            <form
              onSubmit={onSubmit}
              className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 text-sm"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ubicación" required>
                  <input className={inputCls} value={form.ubicacion} onChange={(e) => update('ubicacion', e.target.value)} />
                </Field>
                <Field label="Ruta" required>
                  <input className={inputCls} value={form.ruta} onChange={(e) => update('ruta', e.target.value)} />
                </Field>
                <Field label="Tipo de incidente" required>
                  <input className={inputCls} value={form.tipoIncidente} onChange={(e) => update('tipoIncidente', e.target.value)} />
                </Field>
                <Field label="Gravedad">
                  <select className={inputCls} value={form.gravedad} onChange={(e) => update('gravedad', e.target.value)}>
                    <option value="">—</option>
                    <option value="alta">alta</option>
                    <option value="media">media</option>
                    <option value="baja">baja</option>
                  </select>
                </Field>
                <Field label="Fecha (YYYY-MM-DD)" required>
                  <input className={inputCls} value={form.fecha} onChange={(e) => update('fecha', e.target.value)} placeholder="2026-04-29" />
                </Field>
                <Field label="Hora">
                  <input className={inputCls} value={form.hora} onChange={(e) => update('hora', e.target.value)} placeholder="14:30 o desconocida" />
                </Field>
              </div>

              <Field label="Descripción" required>
                <textarea
                  className={cn(inputCls, 'h-24 resize-y')}
                  value={form.descripcion}
                  onChange={(e) => update('descripcion', e.target.value)}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vehículo">
                  <input className={inputCls} value={form.vehiculo} onChange={(e) => update('vehiculo', e.target.value)} />
                </Field>
                <Field label="Patente">
                  <input className={inputCls} value={form.patente} onChange={(e) => update('patente', e.target.value)} />
                </Field>
                <Field label="Víctimas">
                  <input className={inputCls} value={form.victimas} onChange={(e) => update('victimas', e.target.value)} />
                </Field>
                <Field label="Detenidos">
                  <input className={inputCls} value={form.detenidos} onChange={(e) => update('detenidos', e.target.value)} />
                </Field>
              </div>

              <Field label="URL de la noticia">
                <input className={inputCls} value={form.urlNoticia} onChange={(e) => update('urlNoticia', e.target.value)} placeholder="https://..." />
              </Field>

              <Field label="URL imagen (Open Graph)">
                <input className={inputCls} value={form.ogImageUrl} onChange={(e) => update('ogImageUrl', e.target.value)} placeholder="https://..." />
                {form.ogImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.ogImageUrl}
                    alt="Vista previa"
                    className="mt-2 h-24 w-full rounded border border-slate-800 object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
              </Field>

              {error && (
                <p className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {error}
                </p>
              )}
            </form>

            <footer className="flex items-center justify-between border-t border-slate-800 bg-slate-900/40 px-5 py-3">
              <span className="text-xs text-slate-500">
                {dirty ? 'Hay cambios sin guardar' : 'Sin cambios'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  onClick={onSubmit}
                  disabled={isPending || !dirty}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Guardar
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500';

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
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </span>
      {children}
    </label>
  );
}
