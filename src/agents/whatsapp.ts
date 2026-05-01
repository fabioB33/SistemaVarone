import logger from '../services/logger';
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
const ALERTA_DOWNTIME_MS = 3 * 60_000; // alertar a Varone si downtime > 3 minutos
let intentosReconexion = 0;
let timestampDesconexion: number | null = null;
let alertaDowntimeEnviada = false;

// Watchdog: si no llega ningún mensaje por X horas, asumimos zombie y reiniciamos.
// 6 horas es razonable: en el grupo de Varone entran varios mensajes por día.
const WATCHDOG_INACTIVIDAD_MS = 6 * 60 * 60 * 1000;
let ultimaActividad = Date.now();

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
      logger.warn(`[WhatsApp] Grupo "${ENV.WA_GROUP_NAME}" no encontrado al reconectar.`);
      return;
    }

    logger.info(`[WhatsApp] Procesando historial del grupo "${grupo.name}"...`);
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

    logger.info(`[WhatsApp] Historial procesado: ${procesados} mensajes recientes analizados.`);
  } catch (error) {
    logger.error('[WhatsApp] Error procesando historial:', error);
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
    logger.info('[WhatsApp] Escaneá este código QR:');
    qrcode.generate(qr, { small: true });
    setQrData(qr);
  });

  client.on('ready', async () => {
    logger.info('[WhatsApp] Conectado y escuchando mensajes...');
    intentosReconexion = 0;
    ultimaActividad = Date.now();

    // Si veníamos de una caída, avisar que volvimos
    if (timestampDesconexion && alertaDowntimeEnviada) {
      const downSegs = Math.round((Date.now() - timestampDesconexion) / 1000);
      const mins = Math.floor(downSegs / 60);
      const segs = downSegs % 60;
      await notificar(`✅ *Sistema Varone* WhatsApp reconectado tras ${mins}m ${segs}s de downtime.`).catch(() => {});
    }
    timestampDesconexion = null;
    alertaDowntimeEnviada = false;

    setWaConnected();
    // Registrar el cliente para que el módulo de notificaciones pueda usarlo
    registrarClienteWA(client);
    // Procesar mensajes recientes perdidos durante la desconexión
    await procesarHistorialGrupo();
  });

  client.on('message', async (msg: Message) => {
    try {
      ultimaActividad = Date.now();
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
        logger.info(`[WhatsApp] Rate limit: ignorando mensaje de ${msg.from} (muy frecuente)`);
        return;
      }

      // F4: loguear mensajes no-texto (fotos, audios, docs) para visibilidad
      if (msg.type !== 'chat') {
        logger.info(`[WhatsApp] Mensaje no-texto ignorado (tipo: ${msg.type}) de ${msg.from}`);
        return;
      }

      logger.info(`[WhatsApp] Mensaje recibido en "${chat.name}": ${msg.body.substring(0, 80)}...`);
      await procesarTexto(mensaje.body, 'whatsapp', undefined, undefined, msg.id.id);
    } catch (error) {
      logger.error('[WhatsApp] Error procesando mensaje:', error);
    }
  });

  client.on('disconnected', async (reason) => {
    logger.warn('[WhatsApp] Desconectado:', reason);
    setWaDisconnected();
    await notificarDesconexion(reason);

    if (!timestampDesconexion) timestampDesconexion = Date.now();

    intentosReconexion++;
    const espera = calcularEsperaReconexion();
    logger.info(`[WhatsApp] Reconexión intento ${intentosReconexion}/${RECONEXION_MAX_INTENTOS} en ${espera / 1000}s...`);

    // Alerta temprana: tras 3 min de downtime, avisar a Varone (una sola vez)
    const downtime = Date.now() - timestampDesconexion;
    if (downtime >= ALERTA_DOWNTIME_MS && !alertaDowntimeEnviada) {
      alertaDowntimeEnviada = true;
      const mins = Math.floor(downtime / 60_000);
      await notificar(
        `⚠️ *Sistema Varone* WhatsApp desconectado hace ${mins}m. Reintentando automáticamente. Motivo: ${reason}`
      ).catch(e => logger.error('[WhatsApp] Error enviando alerta downtime:', e));
    }

    if (intentosReconexion >= RECONEXION_MAX_INTENTOS) {
      const msg = `🚨 Sistema Varone — ALERTA CRÍTICA\nWhatsApp no pudo reconectar después de ${RECONEXION_MAX_INTENTOS} intentos.\nMotivo: ${reason}\nIntervención manual requerida.`;
      logger.error(`[WhatsApp] ${msg}`);
      await notificar(msg).catch(() => {});
    }

    setTimeout(() => client.initialize(), espera);
  });

  client.on('auth_failure', async (msg) => {
    logger.error('[WhatsApp] Error de autenticación:', msg);
    setWaDisconnected();
    const alerta = `🔐 *Sistema Varone — Error de autenticación*\nWhatsApp rechazó las credenciales guardadas.\nMotivo: ${msg}\n\nEl sistema reintentará automáticamente. Si persiste, hay que reescanear el QR desde el panel.`;
    await notificar(alerta).catch(e => logger.error('[WhatsApp] Error enviando alerta auth_failure:', e));

    // Reintentar conexión: el QR aparecerá de nuevo en el panel para reescanear.
    // No borramos .wwebjs_auth/ automáticamente — preservamos la sesión por si
    // fue un fallo transitorio. El usuario decide desde el panel si la borra.
    intentosReconexion++;
    setTimeout(() => client.initialize().catch(e => logger.error('[WhatsApp] Re-init falló:', e)), 30_000);
  });

  // Watchdog de inactividad: si no llegan mensajes por 6h, reiniciamos el cliente
  // (el bot puede quedar "vivo pero zombie" — conectado pero sin recibir).
  setInterval(() => {
    if (!client) return;
    const inactivo = Date.now() - ultimaActividad;
    if (inactivo > WATCHDOG_INACTIVIDAD_MS) {
      logger.warn(`[WhatsApp] Watchdog: sin actividad por ${Math.round(inactivo / 60_000)}m. Reiniciando cliente...`);
      ultimaActividad = Date.now(); // evitar re-disparo en bucle
      client.destroy().then(() => {
        client.initialize().catch(e => logger.error('[WhatsApp] Watchdog re-init falló:', e));
      }).catch(e => logger.error('[WhatsApp] Watchdog destroy falló:', e));
    }
  }, 30 * 60_000); // chequea cada 30 min

  client.initialize();
}

export function detenerWhatsApp(): void {
  if (client) {
    client.destroy();
    logger.info('[WhatsApp] Cliente detenido.');
  }
}
