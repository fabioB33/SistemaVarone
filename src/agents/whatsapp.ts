import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { MensajeWhatsApp } from '../types';
import { ENV } from '../config/env';
import { procesarTexto } from '../services/pipeline';
import { setQrData, setWaConnected, setWaDisconnected, notificarDesconexion } from '../dashboard/server';

let client: Client;

// Rastrea mensajes ya procesados del historial para no duplicar con eventos en tiempo real
const procesadosAlReconectar = new Set<string>();

// Rate limit por remitente: máximo 1 mensaje cada 60 segundos por sender
const RATE_LIMIT_MS = 60 * 1000;
const ultimoProcesado = new Map<string, number>();

function dentroDeLimite(senderId: string): boolean {
  const ultimo = ultimoProcesado.get(senderId);
  if (ultimo && Date.now() - ultimo < RATE_LIMIT_MS) return false;
  ultimoProcesado.set(senderId, Date.now());
  return true;
}

async function procesarHistorialGrupo(): Promise<void> {
  try {
    const chats = await client.getChats();
    const grupo = chats.find(c => c.isGroup && c.name === ENV.WA_GROUP_NAME);

    if (!grupo) {
      console.warn(`[WhatsApp] Grupo "${ENV.WA_GROUP_NAME}" no encontrado al reconectar.`);
      return;
    }

    console.log(`[WhatsApp] Procesando historial del grupo "${grupo.name}"...`);
    const mensajes = await grupo.fetchMessages({ limit: 50 });

    let procesados = 0;
    for (const msg of mensajes.reverse()) {
      // Solo mensajes de las últimas 2 horas para no procesar cosas viejas
      const hace2hs = Date.now() / 1000 - 2 * 60 * 60;
      if (msg.timestamp < hace2hs) continue;
      if (!msg.body || msg.body.trim().length < 15) continue;

      procesadosAlReconectar.add(msg.id.id);
      await procesarTexto(msg.body, 'whatsapp');
      procesados++;
    }

    console.log(`[WhatsApp] Historial procesado: ${procesados} mensajes recientes analizados.`);
  } catch (error) {
    console.error('[WhatsApp] Error procesando historial:', error);
  }
}

export function iniciarWhatsApp(): void {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    console.log('[WhatsApp] Escaneá este código QR:');
    qrcode.generate(qr, { small: true });
    setQrData(qr);
  });

  client.on('ready', async () => {
    console.log('[WhatsApp] Conectado y escuchando mensajes...');
    setWaConnected();
    // Procesar mensajes recientes perdidos durante la desconexión
    await procesarHistorialGrupo();
  });

  client.on('message', async (msg: Message) => {
    try {
      const chat = await msg.getChat();

      if (!chat.isGroup || chat.name !== ENV.WA_GROUP_NAME) return;

      // Evitar reprocesar mensajes que ya se leyeron en el historial
      if (procesadosAlReconectar.has(msg.id.id)) {
        procesadosAlReconectar.delete(msg.id.id);
        return;
      }

      const mensaje: MensajeWhatsApp = {
        id: msg.id.id,
        from: msg.from,
        body: msg.body,
        timestamp: msg.timestamp,
        groupName: chat.name,
      };

      if (!dentroDeLimite(msg.from)) {
        console.log(`[WhatsApp] Rate limit: ignorando mensaje de ${msg.from} (muy frecuente)`);
        return;
      }

      console.log(`[WhatsApp] Mensaje recibido en "${chat.name}": ${msg.body.substring(0, 80)}...`);
      await procesarTexto(mensaje.body, 'whatsapp');
    } catch (error) {
      console.error('[WhatsApp] Error procesando mensaje:', error);
    }
  });

  client.on('disconnected', async (reason) => {
    console.warn('[WhatsApp] Desconectado:', reason);
    setWaDisconnected();

    // Notificar la desconexión (Telegram / log / alerta)
    await notificarDesconexion(reason);

    console.log('[WhatsApp] Intentando reconexión en 10 segundos...');
    setTimeout(() => client.initialize(), 10000);
  });

  client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Error de autenticación:', msg);
  });

  client.initialize();
}

export function detenerWhatsApp(): void {
  if (client) {
    client.destroy();
    console.log('[WhatsApp] Cliente detenido.');
  }
}
