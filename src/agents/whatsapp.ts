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
import { setWaStateStatus, bumpWaStateUltimoMensaje, getWaStatePersisted } from '../services/wa-state';

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

// Fix 2026-08-10: el evento 'authenticated' llega cuando el teléfono ya
// confirmó el escaneo del QR, ANTES de 'ready' (que recién llega cuando WA
// Web terminó de cargar el chat completo — puede tardar bastante). Sin este
// flag, el timer de refresh de QR (abajo) no tenía forma de saber que el
// usuario ya escaneó, y podía destruir el cliente a mitad de la autenticación
// si 'ready' tardaba más de QR_REFRESH_MS. Bug reportado por Varone: "escaneé
// y no vinculó".
let autenticando = false;

// QR refresh: whatsapp-web.js NO emite client.on('qr') cada rotación de WhatsApp
// Web (~30s). El primer QR queda servido durante minutos hasta que algún evento
// dispara el handler. Para evitar que el usuario vea siempre el mismo QR mientras
// intenta escanearlo, forzamos un re-init del cliente cada QR_REFRESH_MS si
// seguimos en estado 'qr'. Esto regenera el QR sin que el usuario tenga que
// hacer nada.
const QR_REFRESH_MS = 50_000;
let qrRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// Margen extra tras 'authenticated' antes de forzar reinicio si 'ready' nunca
// llega. Cubre el caso donde el escaneo se confirmó pero Puppeteer se cuelga
// terminando de cargar el chat — sin esto, o se mata la autenticación en
// curso (guard sin margen), o queda pegado para siempre (guard sin timeout).
const AUTENTICANDO_GRACE_MS = 60_000;

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

// Tope máximo de recuperación de historial al reconectar: si la sesión estuvo
// caída más de esto (ej. bot down un fin de semana entero), no tiene sentido
// intentar reprocesar días de mensajes viejos — cubrimos como mucho 24hs hacia
// atrás y confiamos en que el resto ya perdió vigencia como noticia.
const HISTORIAL_MAX_MS = 24 * 60 * 60 * 1000;
// Piso: siempre miramos al menos esta ventana, incluso si `ultimoMensajeEn`
// es muy reciente (evita reprocesar 0 mensajes por un desfasaje de segundos).
const HISTORIAL_MIN_MS = 2 * 60 * 60 * 1000;
// Cuántos mensajes traer del chat como máximo. 50 no alcanzaba para cubrir un
// grupo activo tras varias horas caído — lo subimos con margen.
const HISTORIAL_FETCH_LIMIT = 300;

async function procesarHistorialGrupo(): Promise<void> {
  // El chat de WA Web puede no haber terminado de cargar al momento del 'ready'.
  // fetchMessages() llama internamente a waitForChatLoading que requiere que el
  // chat ya esté abierto en la UI. Esperamos antes de intentar y reintentamos
  // si falla, en vez de tirar el error y dejar el bot zombie.
  await new Promise(resolve => setTimeout(resolve, 8_000));

  // Calculamos la ventana de recuperación en base al último mensaje procesado
  // ANTES de la caída (persistido en DB), no un valor fijo. Así, si el bot
  // estuvo desconectado desde la mañana hasta la noche, recuperamos todo ese
  // hueco en vez de perder las noticias de horas que quedaban fuera de una
  // ventana fija de 2hs (bug reportado por Varone 2026-08-06: reconectó de
  // noche y no trajo nada de lo perdido durante el día).
  const estadoPrevio = await getWaStatePersisted().catch(() => null);
  let ventanaMs = HISTORIAL_MIN_MS;
  if (estadoPrevio?.ultimoMensajeEn) {
    const desdeUltimoMensaje = Date.now() - estadoPrevio.ultimoMensajeEn.getTime();
    ventanaMs = Math.min(Math.max(desdeUltimoMensaje, HISTORIAL_MIN_MS), HISTORIAL_MAX_MS);
  }

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
      mensajes = await grupo.fetchMessages({ limit: HISTORIAL_FETCH_LIMIT });
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

  const corteTimestamp = Date.now() / 1000 - ventanaMs / 1000;
  let procesados = 0;
  for (const msg of mensajes.reverse()) {
    if (msg.timestamp < corteTimestamp) continue;
    if (!msg.body || msg.body.trim().length < 15) continue;

    procesadosAlReconectar.add(msg.id.id);
    await procesarTexto(msg.body, 'whatsapp');
    procesados++;
  }

  const ventanaHoras = (ventanaMs / 3_600_000).toFixed(1);
  logger.info(`[WhatsApp] Historial procesado: ${procesados} mensajes analizados (ventana: ${ventanaHoras}hs, ${mensajes.length} mensajes traídos del chat).`);
}

export function iniciarWhatsApp(): void {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    // Pin de versión de WhatsApp Web: WA Web rota su frontend con frecuencia y
    // el scraper interno de whatsapp-web.js queda fuera de sync, produciendo
    // errores como "Cannot read properties of undefined (reading
    // 'waitForChatLoading')". Pinear un HTML estable de wppconnect-team/wa-version
    // evita el bug. Cuando whatsapp-web.js publique fix oficial, sacar este bloque.
    //
    // Actualizado 2026-08-10: el pin anterior (2.3000.1034733596-alpha, de
    // 2026-05-07, ~3 meses) es sospechoso #1 del bug "no se puede vincular el
    // QR" reportado por Varone — WhatsApp deprecia versiones viejas del
    // frontend para el handshake de NUEVOS vínculos (sesiones ya vinculadas
    // con una versión vieja pueden seguir andando, pero un QR nuevo escaneado
    // contra un protocolo obsoleto puede ser rechazado silenciosamente).
    // Revisar wppconnect-team/wa-version cada ~4-6 semanas y re-pinear a la
    // última versión listada si vuelve a fallar la vinculación.
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1044858477-alpha.html',
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

  const programarQrRefresh = () => {
    if (qrRefreshTimer) clearTimeout(qrRefreshTimer);
    qrRefreshTimer = setTimeout(async () => {
      if (conectado) return; // ya está operativo, no hace falta nada
      if (autenticando) {
        // El teléfono ya escaneó y está autenticando — no matar el cliente a
        // mitad de camino (bug reportado por Varone: "escaneé y no vinculó").
        // Damos un margen extra de AUTENTICANDO_GRACE_MS: si 'ready' sigue sin
        // llegar para entonces, algo se colgó de verdad y ahí sí reiniciamos,
        // para no quedar pegado indefinidamente si Puppeteer nunca emite
        // 'ready' ni 'disconnected'/'auth_failure' tras el escaneo.
        logger.info('[WhatsApp] Escaneo en curso (authenticated sin ready aún) — extendiendo espera antes de refrescar QR.');
        qrRefreshTimer = setTimeout(async () => {
          if (conectado) return;
          logger.warn('[WhatsApp] Autenticación colgada tras escaneo (sin ready). Forzando reinicio.');
          await reiniciarClienteSeguro('qr-refresh-post-auth-stuck');
        }, AUTENTICANDO_GRACE_MS);
        return;
      }
      logger.info('[WhatsApp] Forzando refresh de QR (timeout sin escaneo).');
      await reiniciarClienteSeguro('qr-refresh');
    }, QR_REFRESH_MS);
  };

  client.on('qr', (qr) => {
    logger.info('[WhatsApp] Escaneá este código QR:');
    qrcode.generate(qr, { small: true });
    setQrData(qr);
    cancelarInitWatchdog(); // ya emitió QR, no se quedó colgado al iniciar
    void setWaStateStatus('qr', 'qr');
    autenticando = false; // QR nuevo = todavía no escanearon este

    // Programar re-init para forzar nuevo QR si el usuario no escanea a tiempo.
    programarQrRefresh();
  });

  client.on('authenticated', () => {
    logger.info('[WhatsApp] QR escaneado, autenticando sesión...');
    autenticando = true;
    // No tocamos qrRefreshTimer acá — programarQrRefresh() ya contempla este
    // flag cuando dispare y le da el margen extra correspondiente.
  });

  client.on('ready', async () => {
    logger.info('[WhatsApp] Conectado y escuchando mensajes...');
    intentosReconexion = 0;
    ultimaActividad = Date.now();
    conectado = true;
    autenticando = false;
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
    autenticando = false;
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
    autenticando = false;
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
 *
 * DEBT 2026-08-05: si Puppeteer está realmente colgado (Runtime.callFunctionOn
 * timed out — la página no responde), client.destroy() puede tardar hasta
 * protocolTimeout (5 min) en resolver o rechazar. Como este reinicio puede
 * disparar desde un zombie confirmado, el destroy() tiene su propio timeout
 * corto: si no responde en DESTROY_TIMEOUT_MS, matamos el chromium a nivel OS
 * directamente en vez de esperar a que Puppeteer se rinda solo.
 */
const DESTROY_TIMEOUT_MS = 15_000;

let reiniciandoPorZombie = false;

export async function reiniciarClienteSeguro(origen: string): Promise<void> {
  // Guard: evita reinicios superpuestos si dos triggers (watchdog + healthcheck)
  // disparan casi al mismo tiempo — el segundo destroy() sobre un cliente que
  // ya está siendo destruido puede lanzar errores confusos.
  if (reiniciandoPorZombie) {
    logger.warn(`[WhatsApp] [${origen}] reinicio ya en curso, ignorando trigger duplicado.`);
    return;
  }
  reiniciandoPorZombie = true;
  try {
    try {
      await Promise.race([
        client.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('destroy-timeout')), DESTROY_TIMEOUT_MS)),
      ]);
    } catch (e) {
      const esTimeout = e instanceof Error && e.message === 'destroy-timeout';
      if (esTimeout) {
        logger.warn(`[WhatsApp] [${origen}] destroy() no respondió en ${DESTROY_TIMEOUT_MS / 1000}s (Puppeteer colgado). Matando chromium a nivel OS.`);
        await matarChromiumHuerfano();
      } else {
        logger.error(`[WhatsApp] [${origen}] destroy falló:`, e);
      }
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
  } finally {
    reiniciandoPorZombie = false;
  }
}

export function detenerWhatsApp(): void {
  if (client) {
    client.destroy();
    logger.info('[WhatsApp] Cliente detenido.');
  }
}
