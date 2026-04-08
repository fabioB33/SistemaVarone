import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { MensajeWhatsApp } from '../types';
import { ENV } from '../config/env';
import { procesarTexto } from '../services/pipeline';
import { setQrData, setWaConnected, setWaDisconnected, notificarDesconexion, emitirMensajeGrupo } from '../dashboard/server';
import { registrarClienteWA, notificar } from '../services/notificaciones';

// Reconexión con backoff exponencial
const RECONEXION_BASE_MS = 10_000;   // 10s primer intento
const RECONEXION_MAX_MS = 5 * 60_000; // máximo 5 minutos entre intentos
const RECONEXION_MAX_INTENTOS = 10;   // después de 10 intentos fallidos, alerta crítica
let intentosReconexion = 0;

function calcularEsperaReconexion(): number {
  const espera = Math.min(RECONEXION_BASE_MS * Math.pow(2, intentosReconexion), RECONEXION_MAX_MS);
  return espera;
}

let client: Client;

// Rastrea mensajes ya procesados del historial para no duplicar con eventos en tiempo real.
// Se limpia cada hora para evitar memory leak en sesiones largas.
const procesadosAlReconectar = new Set<string>();
setInterval(() => {
  procesadosAlReconectar.clear();
}, 60 * 60 * 1000);

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
    intentosReconexion = 0;
    setWaConnected();
    // Registrar el cliente para que el módulo de notificaciones pueda usarlo
    registrarClienteWA(client);
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

      // Emitir TODOS los mensajes al dashboard en tiempo real (antes de cualquier filtro)
      const contact = await msg.getContact().catch(() => null);
      emitirMensajeGrupo({
        id: msg.id.id,
        from: msg.from,
        fromName: contact?.pushname || contact?.name || msg.from.split('@')[0],
        body: msg.type === 'chat' ? msg.body : `[${msg.type}]`,
        timestamp: msg.timestamp,
        type: msg.type,
      });

      if (!dentroDeLimite(msg.from)) {
        console.log(`[WhatsApp] Rate limit: ignorando mensaje de ${msg.from} (muy frecuente)`);
        return;
      }

      // F4: loguear mensajes no-texto (fotos, audios, docs) para visibilidad
      if (msg.type !== 'chat') {
        console.log(`[WhatsApp] Mensaje no-texto ignorado (tipo: ${msg.type}) de ${msg.from}`);
        return;
      }

      console.log(`[WhatsApp] Mensaje recibido en "${chat.name}": ${msg.body.substring(0, 80)}...`);
      await procesarTexto(mensaje.body, 'whatsapp', undefined, undefined, msg.id.id);
    } catch (error) {
      console.error('[WhatsApp] Error procesando mensaje:', error);
    }
  });

  client.on('disconnected', async (reason) => {
    console.warn('[WhatsApp] Desconectado:', reason);
    setWaDisconnected();
    await notificarDesconexion(reason);

    intentosReconexion++;
    const espera = calcularEsperaReconexion();
    console.log(`[WhatsApp] Reconexión intento ${intentosReconexion}/${RECONEXION_MAX_INTENTOS} en ${espera / 1000}s...`);

    if (intentosReconexion >= RECONEXION_MAX_INTENTOS) {
      const msg = `🚨 Sistema Varone — ALERTA CRÍTICA\nWhatsApp no pudo reconectar después de ${RECONEXION_MAX_INTENTOS} intentos.\nMotivo: ${reason}\nIntervención manual requerida.`;
      console.error(`[WhatsApp] ${msg}`);
      await notificar(msg);
    }

    setTimeout(() => client.initialize(), espera);
  });

  client.on('auth_failure', async (msg) => {
    console.error('[WhatsApp] Error de autenticación:', msg);
    setWaDisconnected();
    const alerta = `🔐 *Sistema Varone — Error de autenticación*\nWhatsApp rechazó las credenciales guardadas.\nMotivo: ${msg}\n\nAcción requerida: detener el sistema, borrar la carpeta \`.wwebjs_auth/\` y reiniciar para escanear el QR nuevamente.`;
    await notificar(alerta).catch(e => console.error('[WhatsApp] Error enviando alerta auth_failure:', e));
  });

  client.initialize();
}

export function detenerWhatsApp(): void {
  if (client) {
    client.destroy();
    console.log('[WhatsApp] Cliente detenido.');
  }
}
