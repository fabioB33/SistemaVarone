import { analizarConIA } from './ia';
import { existeDuplicado, registrarReporte, obtenerPendientesFramer } from './dedup';
import { enviarAFramer } from './framer';
import { incrementarMetrica, emitirEstadoProcesado } from '../dashboard/server';
import { ReporteIncidente } from '../types';
import { ENV } from '../config/env';

// F2: detectar spike — si entran N reportes relevantes en una ventana de tiempo, alertar
const SPIKE_VENTANA_MS = 10 * 60 * 1000;  // 10 minutos
const SPIKE_UMBRAL = 5;                    // 5 reportes en 10 min = posible incidente activo
const timestampsRecientes: number[] = [];

async function verificarSpike(): Promise<void> {
  const ahora = Date.now();
  // Limpiar entradas fuera de la ventana
  while (timestampsRecientes.length > 0 && ahora - timestampsRecientes[0] > SPIKE_VENTANA_MS) {
    timestampsRecientes.shift();
  }
  timestampsRecientes.push(ahora);

  if (timestampsRecientes.length === SPIKE_UMBRAL) {
    const msg = `🚨 *Sistema Varone — Spike detectado*\n${SPIKE_UMBRAL} reportes en los últimos 10 minutos.\nPosible incidente activo en curso.`;
    console.warn(`[Pipeline] ${msg}`);
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (telegramToken && telegramChatId) {
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: msg, parse_mode: 'Markdown' }),
      }).catch(e => console.error('[Pipeline] Error enviando alerta spike:', e));
    }
  }
}

const PIPELINE_TIMEOUT_MS = 30_000;
const URL_FETCH_TIMEOUT_MS = 10_000;

const URL_REGEX = /^https?:\/\/\S+$/;

/**
 * Si el texto es una URL sola, intenta obtener el contenido de la página.
 * Extrae el texto visible de manera simple (sin dependencias extra).
 * Devuelve el texto enriquecido o el original si falla.
 */
async function enriquecerSiEsUrl(texto: string, urlNoticia?: string): Promise<{ texto: string; url?: string }> {
  const trimmed = texto.trim();
  if (!URL_REGEX.test(trimmed)) return { texto, url: urlNoticia };

  const url = trimmed;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SistemaVarone/1.0)' },
    });
    clearTimeout(timer);

    if (!resp.ok) return { texto, url };

    const html = await resp.text();
    // Extraer texto visible de forma simple: remover tags y decodificar entidades básicas
    const sinTags = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 3000); // Limitar para no saturar el prompt

    if (sinTags.length > 100) {
      console.log(`[Pipeline] URL enriquecida: ${url.substring(0, 60)}... (${sinTags.length} chars)`);
      return { texto: sinTags, url };
    }
  } catch (err) {
    console.warn(`[Pipeline] No se pudo obtener contenido de URL ${url}:`, err instanceof Error ? err.message : err);
  }
  return { texto, url };
}

function conTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms)
    ),
  ]);
}

/**
 * Pipeline principal:
 * 1. Recibe texto crudo (de WA o scraper)
 * 2. Verifica duplicados en PostgreSQL (antes de llamar a la IA para ahorrar API quota)
 * 3. Lo envía a la IA para clasificar y estructurar
 * 4. Si es nuevo y relevante, lo registra y lo envía a Framer
 */
export async function procesarTexto(
  texto: string,
  fuente: 'whatsapp' | 'scraping',
  urlNoticia?: string,
  portalOrigen?: string,
  waMsgId?: string   // id del mensaje de WhatsApp para actualizar el indicador en el chat
): Promise<void> {
  if (texto.trim().length < 15) return;

  try {
    incrementarMetrica('textosTotales');

    // C3: Si el mensaje es solo una URL, obtener el contenido antes de analizar
    const enriquecido = await enriquecerSiEsUrl(texto, urlNoticia);
    texto = enriquecido.texto;
    if (enriquecido.url) urlNoticia = enriquecido.url;

    // Verificar duplicado antes de llamar a la IA para ahorrar quota de API (por hash y por URL)
    const esDuplicado = await existeDuplicado(texto, urlNoticia);
    if (esDuplicado) {
      incrementarMetrica('duplicadosDescartados');
      console.log('[Pipeline] Duplicado detectado, ignorando.');
      if (waMsgId) emitirEstadoProcesado(waMsgId, false);
      return;
    }

    const resultado = await conTimeout(analizarConIA(texto), PIPELINE_TIMEOUT_MS, 'analizarConIA');

    if (!resultado.esRelevante || !resultado.reporte) {
      incrementarMetrica('noRelevantesDescartados');
      console.log(`[Pipeline] Descartado (no relevante) - fuente: ${fuente}`);
      if (waMsgId) emitirEstadoProcesado(waMsgId, false);
      return;
    }

    const reporte = resultado.reporte;
    reporte.fuente = fuente;
    reporte.textoOriginal = texto;
    if (urlNoticia) reporte.urlNoticia = urlNoticia;
    if (portalOrigen) reporte.portalOrigen = portalOrigen;

    // Registrar en DB — obtener el id para trackear estado de Framer
    const datosReporte: Record<string, unknown> = { ...reporte };
    const reporteId = await registrarReporte(texto, datosReporte);
    incrementarMetrica('reportesRegistrados');
    await verificarSpike();

    // Enviar a Framer pasando el id para actualizar el flag
    const framerOk = await enviarAFramer(reporte, reporteId);
    incrementarMetrica(framerOk ? 'framerEnviados' : 'framerFallidos');

    if (waMsgId) emitirEstadoProcesado(waMsgId, true, { gravedad: reporte.gravedad, ubicacion: reporte.ubicacion });
    console.log(`[Pipeline] Procesado: ${reporte.tipoIncidente} en ${reporte.ubicacion} (${fuente})`);
  } catch (error) {
    console.error(`[Pipeline] Error procesando texto (${fuente}):`, error);
  }
}

// R4: guard para evitar ejecuciones solapadas del cron de reintentos
let reintentandoFramer = false;

/**
 * Reintenta enviar a Framer los reportes que fallaron.
 * Se ejecuta periódicamente desde el cron.
 * R2: backoff exponencial — solo reintenta si pasó suficiente tiempo desde el último intento.
 * R4: guard de solapamiento — si ya está corriendo, omite la ejecución.
 */
export async function reintentarFramerPendientes(): Promise<void> {
  if (reintentandoFramer) {
    console.warn('[Pipeline] Reintentos Framer ya en curso, omitiendo ciclo.');
    return;
  }

  reintentandoFramer = true;
  try {
    const pendientes = await obtenerPendientesFramer();
    if (pendientes.length === 0) return;

    // R2: filtrar por backoff — solo reintentar si pasó 2^intentos * 15 minutos
    const ahoraMs = Date.now();
    const INTERVALO_BASE_MS = 15 * 60 * 1000;
    const listos = pendientes.filter(r => {
      const espera = Math.pow(2, r.framerIntentos) * INTERVALO_BASE_MS;
      const ultimoIntento = new Date(r.creadoEn).getTime();
      return ahoraMs - ultimoIntento >= espera;
    });

    if (listos.length === 0) return;
    console.log(`[Pipeline] Reintentando ${listos.length}/${pendientes.length} reportes pendientes de Framer...`);

    for (const r of listos) {
      const reporte: Partial<ReporteIncidente> = {
        fecha: r.fecha,
        hora: r.hora ?? 'desconocida',
        ubicacion: r.ubicacion,
        ruta: r.ruta,
        tipoIncidente: r.tipoIncidente,
        gravedad: r.gravedad ?? undefined,
        descripcion: r.descripcion,
        vehiculo: r.vehiculo ?? undefined,
        patente: r.patente ?? undefined,
        fuente: r.fuente as 'whatsapp' | 'scraping',
        urlNoticia: r.urlNoticia ?? undefined,
        victimas: r.victimas ?? undefined,
        detenidos: r.detenidos ?? undefined,
      };
      await enviarAFramer(reporte as ReporteIncidente, r.id);
    }
  } finally {
    reintentandoFramer = false;
  }
}
