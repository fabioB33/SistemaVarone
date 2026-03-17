import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { MensajeWhatsApp } from '../types';
import { ENV } from '../config/env';
import { procesarTexto } from '../services/pipeline';
import { setQrData, setWaConnected, setWaDisconnected } from '../dashboard/server';

let client: Client;

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

  client.on('ready', () => {
    console.log('[WhatsApp] Conectado y escuchando mensajes...');
    setWaConnected();
  });

  client.on('message', async (msg: Message) => {
    try {
      const chat = await msg.getChat();

      // Solo procesar mensajes del grupo configurado
      if (!chat.isGroup || chat.name !== ENV.WA_GROUP_NAME) return;

      const mensaje: MensajeWhatsApp = {
        id: msg.id.id,
        from: msg.from,
        body: msg.body,
        timestamp: msg.timestamp,
        groupName: chat.name,
      };

      console.log(`[WhatsApp] Mensaje recibido en "${chat.name}": ${msg.body.substring(0, 80)}...`);
      await procesarTexto(mensaje.body, 'whatsapp');
    } catch (error) {
      console.error('[WhatsApp] Error procesando mensaje:', error);
    }
  });

  client.on('disconnected', (reason) => {
    console.warn('[WhatsApp] Desconectado:', reason);
    setWaDisconnected();
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
