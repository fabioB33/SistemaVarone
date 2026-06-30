import {
  ExternalLink,
  MapPin,
  AlertTriangle,
  Clock,
  MessageSquare,
  Globe2,
  Truck,
  Hash,
  User,
} from 'lucide-react';
import { type ReporteListItem } from '@/lib/backend';
import { formatDate, cn } from '@/lib/utils';
import { AprobarButton, DescartarButton } from './accion-buttons';
// Sprint flujo-errores-editables (2026-06-30): ReintentarFalloButton removido,
// el botón unificado ahora vive dentro de CamposFramerInline (modo correccion).
import { EditarReporteDialog } from './editar-reporte-dialog';
import { CamposFramerInline } from './campos-framer-inline';

// Sprint scrapers-portales (2026-06-30): labels human-friendly por portal.
const PORTAL_LABELS: Record<string, string> = {
  'cronica': 'Crónica',
  'diario-popular': 'Diario Popular',
  'infobae': 'Infobae',
  'la-nacion': 'La Nación',
  'clarin': 'Clarín',
  'pagina12': 'Página 12',
};
function portalLabel(p: string): string {
  return PORTAL_LABELS[p] || p;
}

interface Props {
  reporte: ReporteListItem;
  showActions?: boolean;
}

const ESTADO_BADGE = {
  pendiente:  { cls: 'vc-badge-warning',  label: 'Pendiente'  },
  aprobado:   { cls: 'vc-badge-info',     label: 'Aprobado'   },
  publicado:  { cls: 'vc-badge-success',  label: 'Publicado'  },
  descartado: { cls: 'vc-badge-default',  label: 'Descartado' },
} as const;

const GRAVEDAD = {
  alta:  { stripe: 'bg-danger', icon: 'text-danger', label: 'Alta'  },
  media: { stripe: 'bg-warn',   icon: 'text-warn',   label: 'Media' },
  baja:  { stripe: 'bg-ok/70',  icon: 'text-ok',     label: 'Baja'  },
} as const;

export function ReporteCard({ reporte, showActions = false }: Props) {
  const FuenteIcon = reporte.fuente === 'whatsapp' ? MessageSquare : Globe2;
  const estadoBadge = ESTADO_BADGE[reporte.estado as keyof typeof ESTADO_BADGE] ?? ESTADO_BADGE.descartado;
  const gravedadKey = reporte.gravedad as keyof typeof GRAVEDAD | undefined;
  const gravedadCfg = gravedadKey ? GRAVEDAD[gravedadKey] : null;

  const tipoLabel = reporte.tipoIncidente?.replace(/_/g, ' ') || '—';

  return (
    <article className="vc-card vc-card-hover group relative overflow-hidden">
      {/* Stripe lateral por gravedad */}
      {gravedadCfg && (
        <span
          aria-hidden
          className={cn('absolute inset-y-0 left-0 w-1', gravedadCfg.stripe)}
        />
      )}

      <div className="grid gap-4 p-5 sm:grid-cols-[1fr,auto]">
        <div className="min-w-0">
          {/* Meta row: estado + tipo + gravedad + id */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('vc-badge', estadoBadge.cls)}>
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  reporte.estado === 'pendiente' && 'bg-warn animate-pulse-dot',
                  reporte.estado === 'aprobado'  && 'bg-info',
                  reporte.estado === 'publicado' && 'bg-ok',
                  reporte.estado === 'descartado' && 'bg-fg-subtle',
                )}
              />
              {estadoBadge.label}
            </span>
            <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
              <Truck className="size-3" />
              {tipoLabel}
            </span>
            {gravedadCfg && (
              <span className="vc-badge vc-badge-default">
                <AlertTriangle className={cn('size-3', gravedadCfg.icon)} />
                Gravedad {gravedadCfg.label}
              </span>
            )}
          </div>

          {/* Title (ubicación destacada) */}
          <h3 className="mt-3 text-lg font-semibold leading-tight tracking-tight text-fg">
            {reporte.ubicacion || 'Ubicación desconocida'}
          </h3>

          {/* Sub: ruta + fecha + fuente */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
            {reporte.ruta && reporte.ruta !== 'no especificada' && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3" />
                {reporte.ruta}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3" />
              {reporte.fecha === 'desconocida' ? 'Fecha desconocida' : reporte.fecha}
              {reporte.hora && reporte.hora !== 'desconocida' && ` · ${reporte.hora}`}
            </span>
            {/* Sprint flow-claridad (2026-06-30): source badge prominente con
                color verde para WhatsApp / amber para portales. Antes era un
                texto gris muteado igual al resto de los metadatos. */}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold',
                reporte.fuente === 'whatsapp'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
              )}
            >
              <FuenteIcon className="size-3" />
              {reporte.fuente === 'whatsapp'
                ? 'WhatsApp'
                : reporte.portalOrigen
                  ? `📰 ${portalLabel(reporte.portalOrigen)}`
                  : 'Portal web'}
            </span>
          </div>

          {/* Descripción */}
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-fg-secondary">
            {reporte.descripcion}
          </p>

          {/* Sprint flow-unificado-aprobacion (2026-06-28): bloque inline
              con los 10 campos canonical del form Framer. Los faltantes
              salen en amber con select inline. Cuando se completan, el
              botón "Aprobar" se habilita (ver lógica en disabledReason).

              Sprint flujo-errores-editables (2026-06-30): cuando el estado
              es fallo_publicacion, todos los 10 campos son editables y el
              culpable (framerLastErrorField) sale en rojo destacado, con
              botón unificado "Corregir y reintentar publicación". */}
          {reporte.estado === 'pendiente' && (
            <CamposFramerInline reporte={reporte} />
          )}
          {reporte.estado === 'fallo_publicacion' && (
            <CamposFramerInline reporte={reporte} modoCorrecciónFallo />
          )}
        </div>

        {/* Acciones */}
        {showActions && reporte.estado === 'pendiente' && (() => {
          // Sprint flow-unificado-aprobacion (2026-06-28): botón "Aprobar"
          // queda disabled si hay camposFaltantes (Varone tiene que llenar
          // los selects amber primero). El backend también bloquea
          // server-side por defensa en profundidad.
          const faltantes = reporte.camposFaltantes ?? [];
          const disabledReason = faltantes.length > 0
            ? `Faltan ${faltantes.length} dropdown${faltantes.length === 1 ? '' : 's'} (completá los selects en amber arriba)`
            : null;
          return (
            <div className="flex flex-col gap-2 sm:min-w-[10rem] sm:items-stretch">
              <AprobarButton id={reporte.id} disabledReason={disabledReason} />
              <EditarReporteDialog reporte={reporte} />
              <DescartarButton id={reporte.id} />
            </div>
          );
        })()}
        {/* Sprint flujo-errores-editables (2026-06-30): cards en fallo_publicacion
            ahora muestran el bloque inline editable (más arriba en el JSX)
            con botón unificado "Corregir y reintentar". Acá solo queda el
            botón Descartar para casos terminales. */}
        {showActions && reporte.estado === 'fallo_publicacion' && (
          <div className="flex flex-col gap-2 sm:min-w-[10rem] sm:items-stretch">
            <DescartarButton id={reporte.id} />
          </div>
        )}
        {/* Sprint flow-cleanup-legacy (2026-06-30): DespublicarButton removido
            para estados aprobado/publicado (era del flow viejo Framer Server
            API). El sitio público hoy es un formulario sin delete. */}
      </div>

      {/* Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/40 px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-subtle">
          {reporte.urlNoticia && (
            <a
              href={reporte.urlNoticia}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-fg-muted transition-colors hover:text-fg"
            >
              <ExternalLink className="size-3" />
              Ver fuente
            </a>
          )}
          {reporte.framerSlug && (
            <span className="inline-flex items-center gap-1 font-mono text-fg-subtle">
              <Globe2 className="size-3" />
              {reporte.framerSlug}
            </span>
          )}
          {reporte.aprobadoPor && (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" />
              {reporte.aprobadoPor} · {formatDate(reporte.aprobadoEn)}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 font-mono text-2xs text-fg-subtle">
          <Hash className="size-2.5" />
          {reporte.id} · {formatDate(reporte.creadoEn)}
        </span>
      </footer>
    </article>
  );
}
