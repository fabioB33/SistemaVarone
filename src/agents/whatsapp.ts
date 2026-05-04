import logger from '../services/logger';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { MensajeWhatsApp } from '../types';
import { ENV } from '../config/env';
import { procesarTexto } from '../services/pipeline';
import { setQrData, setWaConnected, setWaDisconnected, notificarDesconexion, emitirMensajeGrupo } from '../dashboard/server';
import { registrarClienteWA, notificar } from '../services/notificaciones';
import { setWaStateStatus, bumpWaStateUltimoMensaje } from '../services/wa-state';

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
// Espejo local del estado del cliente WA. Solo el ready handler lo pasa a true,
// solo disconnected/auth_failure lo bajan. Permite al watchdog saber si tiene
// sentido reiniciar (no reiniciar mientras espera QR — rompe el ciclo de QRs).
let conectado = false;

// QR refresh: whatsapp-web.js NO emite client.on('qr') cada rotación de WhatsApp
// Web (~30s). El primer QR queda servido durante minutos hasta que algún evento
// dispara el handler. Para evitar que el usuario vea siempre el mismo QR mientras
// intenta escanearlo, forzamos un re-init del cliente cada QR_REFRESH_MS si
// seguimos en estado 'qr'. Esto regenera el QR sin que el usuario tenga que
// hacer nada.
const QR_REFRESH_MS = 50_000;
let qrRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// Init watchdog: si el cliente queda colgado al iniciar (Puppeteer timeout,
// crash silencioso, o cualquier otra razón) y no emite ni 'qr' ni 'ready' en
// 90s, asumimos que se rompió y reiniciamos limpio. Cubre el caso del bug
// "Runtime.callFunctionOn timed out" donde el bot queda disconnected sin pedir QR.
const INIT_TIMEOUT_MS = 90_000;
let initTimer: ReturnType<typeof setTimeout> | null = null;

function armarInitWatchdog(): void {
  if (initTimer) clearTimeout(initTimer);
  initTimer = setTimeout(() => {
    if (conectado) return; // ya está OK
    if (qrRefreshTimer) return; // está en estado QR (timer activo), no es necesario
    logger.warn('[WhatsApp] Init watchdog: 90s sin qr ni ready, reiniciando cliente...');
    reiniciarClienteSeguro('init-watchdog').catch(e =>
      logger.error('[WhatsApp] Init watchdog re-init falló:', e),
    );
  }, INIT_TIMEOUT_MS);
}

function cancelarInitWatchdog(): void {
  if (initTimer) {
    clearTimeout(initTimer);
    initTimer = null;
  }
}

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
      // protocolTimeout: WhatsApp Web a veces tarda >30s en cargar (default Puppeteer
      // es 30s). Subimos a 5min para evitar "Runtime.callFunctionOn timed out" durante
      // la inicialización en máquinas con red lenta o cuando WA Web está lento.
      protocolTimeout: 5 * 60_000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',         // evita crash en /dev/shm chico (común en VPS)
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',                   // headless no necesita GPU
      ],
    },
  });

  client.on('qr', (qr) => {
    logger.info('[WhatsApp] Escaneá este código QR:');
    qrcode.generate(qr, { small: true });
    setQrData(qr);
    cancelarInitWatchdog(); // ya emitió QR, no se quedó colgado al iniciar
    void setWaStateStatus('qr', 'qr');

    // Programar re-init para forzar nuevo QR si el usuario no escanea a tiempo.
    // Cancelamos el timer anterior (si existe) y agendamos uno fresco.
    if (qrRefreshTimer) clearTimeout(qrRefreshTimer);
    qrRefreshTimer = setTimeout(async () => {
      if (conectado) return; // ya escaneo, no necesitamos refrescar
      logger.info('[WhatsApp] Forzando refresh de QR (timeout sin escaneo).');
      await reiniciarClienteSeguro('qr-refresh');
    }, QR_REFRESH_MS);
  });

  client.on('ready', async () => {
    logger.info('[WhatsApp] Conectado y escuchando mensajes...');
    intentosReconexion = 0;
    ultimaActividad = Date.now();
    conectado = true;
    cancelarInitWatchdog();
    void setWaStateStatus('connected', 'ready', { groupName: ENV.WA_GROUP_NAME });
    // Cancelar timer de refresh de QR (ya no hace falta, estamos conectados)
    if (qrRefreshTimer) {
      clearTimeout(qrRefreshTimer);
      qrRefreshTimer = null;
    }

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

      // Bumpea ultimoMensajeEn en DB (lo usa el healthcheck para detectar zombies).
      // Lo hacemos antes del rate-limit/type filter porque incluso mensajes ignorados
      // son señal de actividad en el grupo.
      void bumpWaStateUltimoMensaje();

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
    conectado = false;
    setWaDisconnected();
    void setWaStateStatus('disconnected', 'disconnected', { reason: String(reason) });
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
    conectado = false;
    setWaDisconnected();
    void setWaStateStatus('disconnected', 'auth_failure', { reason: String(msg) });
    const alerta = `🔐 *Sistema Varone — Error de autenticación*\nWhatsApp rechazó las credenciales guardadas.\nMotivo: ${msg}\n\nEl sistema reintentará automáticamente. Si persiste, hay que reescanear el QR desde el panel.`;
    await notificar(alerta).catch(e => logger.error('[WhatsApp] Error enviando alerta auth_failure:', e));

    // Reintentar conexión: el QR aparecerá de nuevo en el panel para reescanear.
    // No borramos .wwebjs_auth/ automáticamente — preservamos la sesión por si
    // fue un fallo transitorio. El usuario decide desde el panel si la borra.
    intentosReconexion++;
    setTimeout(() => client.initialize().catch(e => logger.error('[WhatsApp] Re-init falló:', e)), 30_000);
  });

  // Watchdog de inactividad: si no llegan mensajes por 6h ESTANDO CONECTADO,
  // reiniciamos el cliente (puede haber quedado "vivo pero zombie" — conectado
  // pero sin recibir mensajes nuevos).
  //
  // Importante: solo dispara si el estado es "connected". Cuando el bot está
  // esperando QR (status="qr") o desconectado, "sin actividad" es lo normal y
  // no debe reiniciar nada — destruir el cliente en estado QR rompe el ciclo
  // de generación de QRs.
  setInterval(() => {
    if (!client) return;
    if (!conectado) return;  // no reiniciar mientras espera QR o está desconectado
    const inactivo = Date.now() - ultimaActividad;
    if (inactivo > WATCHDOG_INACTIVIDAD_MS) {
      logger.warn(`[WhatsApp] Watchdog: sin actividad por ${Math.round(inactivo / 60_000)}m. Reiniciando cliente...`);
      ultimaActividad = Date.now(); // evitar re-disparo en bucle
      reiniciarClienteSeguro('watchdog');
    }
  }, 30 * 60_000); // chequea cada 30 min

  // Armamos el init watchdog antes de llamar initialize() — si el cliente queda
  // colgado en Puppeteer (callFunctionOn timeout, etc.) se reinicia solo en 90s.
  armarInitWatchdog();
  client.initialize().catch(e => {
    logger.error('[WhatsApp] initialize() falló:', e);
  });
}

/**
 * Reinicia el cliente WhatsApp de forma segura: destroy + delay + initialize.
 * El delay es CRÍTICO porque Puppeteer no libera inmediatamente el lock del
 * userDataDir; hacer initialize() inmediatamente falla con "browser already running".
 */
async function reiniciarClienteSeguro(origen: string): Promise<void> {
  try {
    await client.destroy();
  } catch (e) {
    logger.error(`[WhatsApp] [${origen}] destroy falló:`, e);
  }
  // Espera para que Puppeteer libere el lock del userDataDir.
  await new Promise(resolve => setTimeout(resolve, 5_000));
  // Re-armar init watchdog: si este re-init también falla, otro retry en 90s.
  armarInitWatchdog();
  try {
    await client.initialize();
    logger.info(`[WhatsApp] [${origen}] cliente reiniciado correctamente.`);
  } catch (e) {
    logger.error(`[WhatsApp] [${origen}] re-init falló:`, e);
  }
}

export function detenerWhatsApp(): void {
  if (client) {
    client.destroy();
    logger.info('[WhatsApp] Cliente detenido.');
  }
}
