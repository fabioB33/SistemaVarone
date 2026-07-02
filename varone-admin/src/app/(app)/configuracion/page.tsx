/**
 * Sprint admin-config (2026-06-30) — Página /configuracion.
 *
 * Panel para que Varone (administrador) pueda editar:
 *  - Qué portales están habilitados para el scraper
 *  - Nombre del grupo de WhatsApp que el bot monitorea
 *
 * Cambios aplican al siguiente ciclo del cron (portales) o al próximo restart
 * del bot (WhatsApp).
 */

import { Settings } from 'lucide-react';
import { obtenerConfigAdmin } from '@/lib/backend';
import { PortalesForm } from './portales-form';
import { WhatsAppForm } from './whatsapp-form';

export const dynamic = 'force-dynamic';

export default async function ConfiguracionPage() {
  const config = await obtenerConfigAdmin();

  if (!config) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold text-fg">Configuración</h1>
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">
            No se pudo leer la configuración del backend. ¿Está corriendo?
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
          <Settings className="size-3 text-accent" />
          Administración
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">
          Configuración del sistema
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-fg-muted">
          Panel exclusivo para el administrador. Los cambios acá afectan al
          scraper de portales y al bot de WhatsApp. Guardá cada sección por
          separado.
        </p>
      </header>

      <PortalesForm
        initialActivos={config.portales.activos}
        disponibles={config.portales.disponibles}
      />

      <WhatsAppForm
        initialGroupName={config.whatsapp.groupName}
        envDefault={config.whatsapp.groupNameEnv}
      />
    </section>
  );
}
