import crypto from 'crypto';
import { ENV } from '../config/env';

// Chat ID de WhatsApp para mensajes directos: número@c.us
const VARONE_CHAT_ID = `${ENV.VARONE_WA_NUMBER}@c.us`;

// TTL de los tokens de quick action: 24hs.
// Suficiente para que Varone responda al día siguiente sin perder el link.
const QUICK_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

// Referencia al cliente de WhatsApp — se setea una vez que el agente conecta
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _waClient: { sendMessage: (chatId: string, text: string) => Promise<any> } | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registrarClienteWA(client: { sendMessage: (chatId: string, text: string) => Promise<any> }): void {
  _waClient = client;
}

/**
 * Envía un mensaje de alerta directamente a Varone por WhatsApp.
 * Si WhatsApp no está disponible, loguea en consola como fallback.
 */
export async function notificar(texto: string): Promise<void> {
  if (_waClient) {
    try {
      await _waClient.sendMessage(VARONE_CHAT_ID, texto);
      console.log(`[Notif] Mensaje enviado a Varone (${ENV.VARONE_WA_NUMBER})`);
      return;
    } catch (e) {
      console.error('[Notif] Error enviando WA, fallback a consola:', e);
    }
  }
  // Fallback: si WA no está disponible todavía (ej: durante el arranque)
  console.warn(`[Notif] (sin WA disponible) ${texto}`);
}

// ─── Quick action tokens (Aprobar/Descartar desde WhatsApp) ──────────────────

export type QuickAction = 'aprobar' | 'descartar';

interface QuickPayload {
  id: number;
  action: QuickAction;
  exp: number; // timestamp en ms
}

/**
 * Genera un token firmado para una accion rapida (aprobar/descartar) sobre
 * un reporte. El token va embebido en el link que Varone recibe por WhatsApp.
 * Sin este token, el link no funciona (ataque defensivo si alguien intenta
 * adivinar IDs).
 */
export function firmarQuickAction(reporteId: number, action: QuickAction): string {
  if (!ENV.QUICK_ACTION_SECRET || ENV.QUICK_ACTION_SECRET.length < 32) {
    throw new Error('QUICK_ACTION_SECRET no configurado o demasiado corto (>=32 chars)');
  }
  const payload: QuickPayload = {
    id: reporteId,
    action,
    exp: Date.now() + QUICK_ACTION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', ENV.QUICK_ACTION_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verifica un token de quick action. Devuelve el payload si es valido,
 * o null si la firma no coincide o ya expiro.
 */
export function verificarQuickAction(token: string): QuickPayload | null {
  if (!ENV.QUICK_ACTION_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', ENV.QUICK_ACTION_SECRET)
    .update(body)
    .digest('base64url');
  // Comparacion timing-safe
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuickPayload;
    if (typeof payload?.id !== 'number') return null;
    if (payload.action !== 'aprobar' && payload.action !== 'descartar') return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Notificacion de reporte pendiente ──────────────────────────────────────

interface ReporteNotif {
  id: number;
  tipoIncidente: string;
  ubicacion: string;
  ruta: string;
  fecha: string;
  descripcion: string;
}

/**
 * Notifica a Varone por WhatsApp que entro un reporte nuevo a la cola de
 * aprobacion. Incluye links firmados para aprobar/descartar con un tap,
 * y el link al panel para edicion completa.
 *
 * No falla el flujo si la notificacion no se puede enviar — solo loguea.
 */
export async function notificarReportePendiente(reporte: ReporteNotif): Promise<void> {
  try {
    const tokenAprobar = firmarQuickAction(reporte.id, 'aprobar');
    const tokenDescartar = firmarQuickAction(reporte.id, 'descartar');
    const base = ENV.ADMIN_PUBLIC_URL.replace(/\/+$/, '');

    const linkAprobar = `${base}/quick/${tokenAprobar}`;
    const linkDescartar = `${base}/quick/${tokenDescartar}`;
    const linkPanel = `${base}/aprobacion`;

    // Resumen: primera oracion de la descripcion (max 200 chars).
    const resumen = (reporte.descripcion || '')
      .split(/(?<=[.!?])\s/)[0]
      ?.slice(0, 200)
      ?.trim();

    const tipo = reporte.tipoIncidente.toUpperCase();
    const lineas = [
      `🚨 *Nuevo reporte pendiente* #${reporte.id}`,
      ``,
      `📍 *${tipo}* — ${reporte.ubicacion}`,
      reporte.ruta && reporte.ruta !== 'no especificada' && reporte.ruta !== 'desconocida'
        ? `🛣️ ${reporte.ruta}`
        : null,
      reporte.fecha && reporte.fecha !== 'desconocida' ? `📅 ${reporte.fecha}` : null,
      ``,
      resumen ? `_${resumen}_` : null,
      ``,
      `✅ Aprobar: ${linkAprobar}`,
      `❌ Descartar: ${linkDescartar}`,
      `📋 Editar / ver: ${linkPanel}`,
    ].filter(Boolean);

    await notificar(lineas.join('\n'));
  } catch (e) {
    console.error('[Notif] Error armando notificacion de reporte pendiente:', e);
  }
}

// ─── Notificacion informativa de reporte auto-publicado ─────────────────────

/**
 * Notifica a Varone por WhatsApp que la IA auto-aprobó y mandó a Framer un
 * reporte nuevo. A diferencia de notificarReportePendiente, NO incluye links
 * de aprobar/descartar (la IA ya decidió). Solo informa y deja link al panel
 * para que pueda DESPUBLICAR si detecta algo mal.
 *
 * No falla el flujo si la notificacion no se puede enviar — solo loguea.
 */
export async function notificarReporteAutopublicado(reporte: ReporteNotif): Promise<void> {
  try {
    const base = ENV.ADMIN_PUBLIC_URL.replace(/\/+$/, '');
    const linkPanel = `${base}/aprobacion?estado=aprobado`;

    // Resumen: primera oracion de la descripcion (max 200 chars).
    const resumen = (reporte.descripcion || '')
      .split(/(?<=[.!?])\s/)[0]
      ?.slice(0, 200)
      ?.trim();

    const tipo = reporte.tipoIncidente.toUpperCase();
    const lineas = [
      `🤖 *Auto-publicado por IA* #${reporte.id}`,
      ``,
      `📍 *${tipo}* — ${reporte.ubicacion}`,
      reporte.ruta && reporte.ruta !== 'no especificada' && reporte.ruta !== 'desconocida'
        ? `🛣️ ${reporte.ruta}`
        : null,
      reporte.fecha && reporte.fecha !== 'desconocida' ? `📅 ${reporte.fecha}` : null,
      ``,
      resumen ? `_${resumen}_` : null,
      ``,
      `Si está mal, despublicalo desde el panel:`,
      `📋 ${linkPanel}`,
    ].filter(Boolean);

    await notificar(lineas.join('\n'));
  } catch (e) {
    console.error('[Notif] Error armando notificacion de reporte auto-publicado:', e);
  }
}
