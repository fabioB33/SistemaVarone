import { ExternalLink, MapPin, AlertTriangle, Clock, MessageSquare, Globe } from 'lucide-react';
import { type ReporteListItem } from '@/lib/backend';
import { formatDate, cn } from '@/lib/utils';
import { AprobarButton, DescartarButton } from './accion-buttons';
import { EditarReporteDialog } from './editar-reporte-dialog';

interface Props {
  reporte: ReporteListItem;
  showActions?: boolean;
}

const GRAVEDAD_STYLES: Record<string, string> = {
  alta: 'bg-red-500/15 text-red-300 border-red-500/30',
  media: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  baja: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

const ESTADO_STYLES: Record<string, string> = {
  pendiente: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  aprobado: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  publicado: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  descartado: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

export function ReporteCard({ reporte, showActions = false }: Props) {
  const FuenteIcon = reporte.fuente === 'whatsapp' ? MessageSquare : Globe;

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition hover:border-slate-700">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                ESTADO_STYLES[reporte.estado] ?? ESTADO_STYLES.descartado,
              )}
            >
              {reporte.estado}
            </span>
            <span className="text-xs uppercase tracking-wider text-slate-400">
              {reporte.tipoIncidente?.replace(/_/g, ' ')}
            </span>
            {reporte.gravedad && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase',
                  GRAVEDAD_STYLES[reporte.gravedad] ?? GRAVEDAD_STYLES.baja,
                )}
              >
                <AlertTriangle className="size-3" /> {reporte.gravedad}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 text-slate-500" />
              <strong>{reporte.ubicacion || '—'}</strong>
              {reporte.ruta && <span className="text-slate-500">· {reporte.ruta}</span>}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="size-3" />
              {reporte.fecha} {reporte.hora && reporte.hora !== 'desconocida' ? reporte.hora : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <FuenteIcon className="size-3" /> {reporte.fuente}
            </span>
          </div>
        </div>

        {showActions && reporte.estado === 'pendiente' && (
          <div className="flex flex-col items-end gap-2">
            <AprobarButton id={reporte.id} />
            <EditarReporteDialog reporte={reporte} />
            <DescartarButton id={reporte.id} />
          </div>
        )}
      </header>

      <p className="mt-3 text-sm leading-relaxed text-slate-300">{reporte.descripcion}</p>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          {reporte.urlNoticia && (
            <a
              href={reporte.urlNoticia}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
            >
              <ExternalLink className="size-3" /> Fuente
            </a>
          )}
          {reporte.framerSlug && (
            <span className="text-slate-600">
              Framer: <code className="text-slate-400">{reporte.framerSlug}</code>
            </span>
          )}
          {reporte.aprobadoPor && (
            <span>
              Por <span className="text-slate-300">{reporte.aprobadoPor}</span> · {formatDate(reporte.aprobadoEn)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-600">#{reporte.id} · {formatDate(reporte.creadoEn)}</span>
      </footer>
    </article>
  );
}
