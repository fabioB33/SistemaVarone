/**
 * Sprint sugerencias-extras (2026-06-30) — Widget WhatsApp status para Centro
 * de Comando.
 *
 * Card grande con estado del bot:
 *   - 🟢 Conectado · grupo "X" · último mensaje hace Y min
 *   - 🟡 Esperando QR
 *   - 🔴 Desconectado
 *   - ⚪ Sin info (backend / WA caído)
 */

import { MessageSquareDot, MessageSquareOff, QrCode, AlertCircle, Clock } from 'lucide-react';
import { obtenerWaStatus } from '@/lib/backend';

function hace(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

export async function WhatsAppWidget() {
  const wa = await obtenerWaStatus();

  let icon = MessageSquareOff;
  let titulo = 'Sin info del bot';
  let colorBox = 'border-fg-muted/30 bg-bg-elevated';
  let colorIcon = 'text-fg-muted';
  let detalleLine: string | null = null;

  if (wa) {
    if (wa.status === 'connected') {
      icon = MessageSquareDot;
      colorBox = 'border-emerald-500/30 bg-emerald-500/5';
      colorIcon = 'text-emerald-500';
      titulo = wa.cargando ? 'Conectando…' : 'Bot WhatsApp activo';
      detalleLine = `Grupo "${wa.groupName ?? '—'}" · último mensaje ${hace(wa.ultimoReporteEn)}`;
    } else if (wa.status === 'qr') {
      icon = QrCode;
      colorBox = 'border-amber-500/30 bg-amber-500/5';
      colorIcon = 'text-amber-500';
      titulo = 'Esperando QR';
      detalleLine = 'Andá a /aprobacion para escanearlo';
    } else {
      icon = AlertCircle;
      colorBox = 'border-red-500/30 bg-red-500/5';
      colorIcon = 'text-red-500';
      titulo = 'Bot desconectado';
      detalleLine = 'No estás recibiendo mensajes del grupo';
    }
  }

  const Icon = icon;

  return (
    <article className={`rounded-lg border p-5 ${colorBox}`}>
      <div className="flex items-start gap-4">
        <div className={`rounded-lg bg-bg-elevated p-2.5 ring-1 ring-border ${colorIcon}`}>
          <Icon className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{titulo}</h3>
          {detalleLine && <p className="mt-1 text-xs text-fg-muted">{detalleLine}</p>}
          {wa && wa.pendientes > 0 && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-semibold text-amber-700 dark:text-amber-300">
              <Clock className="size-3" />
              {wa.pendientes} pendientes esperando revisión
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
