import { ENV } from '../config/env';

// Chat ID de WhatsApp para mensajes directos: número@c.us
const VARONE_CHAT_ID = `${ENV.VARONE_WA_NUMBER}@c.us`;

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
