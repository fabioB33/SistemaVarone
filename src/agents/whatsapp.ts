import logger from '../services/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { MensajeWhatsApp } from '../types';
import { ENV } from '../config/env';
import { procesarTexto } from '../services/pipeline';
import { setQrData, setWaConnected, setWaDisconnected, notificarDesconexion, emitirMensajeGrupo } from '../dashboard/server';
import { registrarClienteWA, notificar } from '../services/notificaciones';
import { setWaStateStatus, bumpWaStateUltimoMensaje } from '../services/wa-state';

const execAsync = promisify(exec);

/**
 * Mata cualquier chromium huérfano que haya quedado lockeando .wwebjs_auth/session/.
 * Se invoca antes de un re-init cuando detectamos error "browser already running".
 *
 * Sin esto, el cliente queda zombie indefinidamente: client.destroy() no termina
 * el proceso chromium subyacente cuando Puppeteer perdió el handle, y cada
 * subsiguiente initialize() falla porque el userDataDir sigue lockeado.
 *
 * Solo mata procesos cuya línea de comando contenga "wwebjs_auth/session" —
 * NO toca otros chromiums (Brave, VSCode, Puppeteer de otros proyectos).
 */
async function matarChromiumHuerfano(): Promise<void> {
  try {
    await execAsync('pkill -9 -f "wwebjs_auth/session"');
    logger.warn('[WhatsApp] Chromium huérfano matado para liberar userDataDir lock.');
    // Pequeña espera para que el OS libere el lock del filesystem.
    await new Promise(resolve => setTimeout(resolve, 2_000));
  } catch (e) {
    // pkill exit 1 = no había procesos para matar (caso normal y esperado).
    // execAsync envuelve el error con `code` como propiedad del error o como
    // string en el message. Chequeamos ambos para evitar el log spurio.
    const err = e as { code?: number; message?: string };
    const exitCode = err.code;
    const messageHasExit1 = err.message?.includes('exit code 1') ||
                            err.message?.includes('Command failed: pkill');
    if (exitCode === 1 || messageHasExit1) {
      // Caso normal: no había chromium para matar. Log debug, no error.
      logger.info('[WhatsApp] matarChromiumHuerfano: no había procesos (esperado).');
      return;
    }
    logger.error('[WhatsApp] matarChromiumHuerfano: error inesperado:', e);
  }
}

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
  // El chat de WA Web puede no haber terminado de cargar al momento del 'ready'.
  // fetchMessages() llama internamente a waitForChatLoading que requiere que el
  // chat ya esté abierto en la UI. Esperamos antes de intentar y reintentamos
  // si falla, en vez de tirar el error y dejar el bot zombie.
  await new Promise(resolve => setTimeout(resolve, 8_000));

  let chats: Awaited<ReturnType<typeof client.getChats>>;
  try {
    chats = await client.getChats();
  } catch (error) {
    logger.error('[WhatsApp] Error obteniendo lista de chats:', error);
    return;
  }

  // Sprint mejoras-flujo (2026-06-30): leer group name desde config_admin
  // en vez de ENV, así se respeta el override que Varone hizo en /configuracion.
  const { obtenerWaGroupName } = await import('../services/config-admin');
  const groupName = await obtenerWaGroupName();
  const grupo = chats.find(c => c.isGroup && c.name === groupName);
  if (!grupo) {
    logger.warn(`[WhatsApp] Grupo "${groupName}" no encontrado al reconectar.`);
    return;
  }

  logger.info(`[WhatsApp] Procesando historial del grupo "${grupo.name}"...`);

  // Reintenta hasta 3 veces con backoff: el chat suele estar listo al 2do intento.
  const MAX_INTENTOS = 3;
  let mensajes: Awaited<ReturnType<typeof grupo.fetchMessages>> | null = null;
  for (let i = 1; i <= MAX_INTENTOS; i++) {
    try {
      mensajes = await grupo.fetchMessages({ limit: 50 });
      break;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[WhatsApp] fetchMessages intento ${i}/${MAX_INTENTOS} falló: ${msg.slice(0, 100)}`);
      if (i < MAX_INTENTOS) {
        await new Promise(resolve => setTimeout(resolve, i * 5_000));
      }
    }
  }

  if (!mensajes) {
    logger.error('[WhatsApp] Historial no procesado tras reintentos. Mensajes en vivo siguen funcionando.');
    return;
  }

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
}

export function iniciarWhatsApp(): void {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    // Pin de versión de WhatsApp Web: WA Web rota su frontend con frecuencia y
    // el scraper interno de whatsapp-web.js queda fuera de sync, produciendo
    // errores como "Cannot read properties of undefined (reading
    // 'waitForChatLoading')". Pinear un HTML estable de wppconnect-team/wa-version
    // evita el bug. Cuando whatsapp-web.js publique fix oficial, sacar este bloque.
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1034733596-alpha.html',
    },
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
    // Fix QR (2026-07-06): flipear el estado a "connected" YA, sin bloquear en
    // el lookup del nombre del grupo (query DB). Bajo carga ese await demoraba el
    // cambio de estado del QR tras vincular. Resolvemos el grupo async y
    // actualizamos el estado cuando esté listo.
    void setWaStateStatus('connected', 'ready', {});
    void (async () => {
      try {
        const { obtenerWaGroupName: obtenerWaGroupNameReady } = await import('../services/config-admin');
        void setWaStateStatus('connected', 'ready', { groupName: await obtenerWaGroupNameReady() });
      } catch (err) {
        logger.error(`[WhatsApp] resolve group name post-ready: ${err instanceof Error ? err.message : err}`);
      }
    })();
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

      // Sprint mejoras-flujo (2026-06-30): usar config_admin en vez de ENV
      // para que el override desde /configuracion aplique sin restart.
      const { obtenerWaGroupName: obtenerWaGroupNameMsg } = await import('../services/config-admin');
      const groupNameActual = await obtenerWaGroupNameMsg();
      if (!chat.isGroup || chat.name !== groupNameActual) return;

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
 *
 * Si tras destroy + delay el initialize() sigue fallando con "browser already running",
 * significa que quedó un chromium huérfano (Puppeteer perdió el handle del proceso
 * pero el proceso chromium sigue vivo lockeando el userDataDir). En ese caso lo
 * matamos a nivel OS y reintentamos una vez más.
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
    return;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const esBrowserLock = errMsg.includes('browser is already running') ||
                          errMsg.includes('userDataDir') ||
                          errMsg.includes('SingletonLock');
    if (!esBrowserLock) {
      logger.error(`[WhatsApp] [${origen}] re-init falló:`, e);
      return;
    }
    logger.warn(`[WhatsApp] [${origen}] re-init falló por chromium huérfano. Limpiando y reintentando una vez...`);
    await matarChromiumHuerfano();
    armarInitWatchdog();
    try {
      await client.initialize();
      logger.info(`[WhatsApp] [${origen}] cliente reiniciado tras cleanup de chromium huérfano.`);
    } catch (e2) {
      logger.error(`[WhatsApp] [${origen}] re-init post-cleanup también falló:`, e2);
    }
  }
}

export function detenerWhatsApp(): void {
  if (client) {
    client.destroy();
    logger.info('[WhatsApp] Cliente detenido.');
  }
}
