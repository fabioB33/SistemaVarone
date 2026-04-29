import { listarReportes } from '@/lib/backend';
import { EstadoTabs, type Estado } from '@/components/estado-tabs';
import { ReporteCard } from '@/components/reporte-card';
import { PublicarSitioButton } from '@/components/accion-buttons';
import { WaStatusPanel } from '@/components/wa-status-panel';
import { Inbox } from 'lucide-react';

export const dynamic = 'force-dynamic';

const VALID_ESTADOS: readonly Estado[] = ['pendiente', 'aprobado', 'publicado', 'descartado'] as const;

function isValid(value: string | undefined): value is Estado {
  return !!value && (VALID_ESTADOS as readonly string[]).includes(value);
}

export default async function AprobacionPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const sp = await searchParams;
  const estado: Estado = isValid(sp.estado) ? sp.estado : 'pendiente';

  const [pendientes, aprobados, publicados, descartados, items] = await Promise.all([
    listarReportes('pendiente'),
    listarReportes('aprobado'),
    listarReportes('publicado'),
    listarReportes('descartado'),
    listarReportes(estado),
  ]);

  const counts = {
    pendiente: pendientes.length,
    aprobado: aprobados.length,
    publicado: publicados.length,
    descartado: descartados.length,
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Aprobación de noticias</h1>
          <p className="text-sm text-slate-400">
            Revisá los reportes capturados, aprobá los que vayan al sitio y descartá el resto.
          </p>
        </div>
        <PublicarSitioButton pendientesPublicar={counts.aprobado} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <EstadoTabs estado={estado} counts={counts} />
          {items.length === 0 ? (
            <EmptyState estado={estado} />
          ) : (
            <div className="space-y-3">
              {items.map((r) => (
                <ReporteCard
                  key={r.id}
                  reporte={r}
                  showActions={estado === 'pendiente'}
                />
              ))}
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-20 lg:h-fit">
          <WaStatusPanel />
        </div>
      </div>
    </section>
  );
}

function EmptyState({ estado }: { estado: Estado }) {
  const messages: Record<Estado, string> = {
    pendiente: 'No hay reportes pendientes. Todo al día.',
    aprobado: 'Sin reportes aprobados en cola.',
    publicado: 'Aún no hay reportes publicados en el sitio.',
    descartado: 'Sin reportes descartados.',
  };
  return (
    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/20 p-10 text-center">
      <Inbox className="mx-auto mb-3 size-8 text-slate-700" />
      <p className="text-sm text-slate-400">{messages[estado]}</p>
    </div>
  );
}
