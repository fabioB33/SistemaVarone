import { analizarConIA } from './ia';
import { existeDuplicado, registrarReporte, obtenerPendientesFramer } from './dedup';
import { enviarAFramer } from './framer';
import { incrementarMetrica, emitirEstadoProcesado } from '../dashboard/server';
import { ReporteIncidente } from '../types';
import { ENV } from '../config/env';
import logger from './logger';
import prisma from './prisma';

// Sprint hardening 13-mejoras (2026-06-27) — spike detector persistente.
//
// Antes: array en memoria que se perdía con cada restart.
// Ahora: cuenta reportes en DB de los últimos 10 min. Sobrevive reinicios.
//
// Cooldown: para no spamear alertas (si entran 6, 7, 8 reportes seguidos
// arriba del umbral), solo alertamos UNA VEZ por hora.
const SPIKE_VENTANA_MS = 10 * 60 * 1000; // 10 minutos
const SPIKE_UMBRAL = 5;                   // 5 reportes en 10 min
const SPIKE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora sin re-alertar
let ultimoAlertaSpike = 0;

async function verificarSpike(): Promise<void> {
  try {
    const prismaModule = await import('./prisma');
    const prisma = prismaModule.default;
    const desde = new Date(Date.now() - SPIKE_VENTANA_MS);
    const count = await prisma.reporte.count({ where: { creadoEn: { gte: desde } } });

    if (count < SPIKE_UMBRAL) return;
    if (Date.now() - ultimoAlertaSpike < SPIKE_COOLDOWN_MS) return; // cooldown activo

    ultimoAlertaSpike = Date.now();
    const msg = `🚨 *Sistema Varone — Spike detectado*\n${count} reportes en los últimos 10 minutos.\nPosible incidente activo en curso.`;
    logger.warn(`[Pipeline] ${msg}`);

    // Persistir como Alerta (tabla existente desde Sprint anterior)
    try {
      await prisma.alerta.create({
        data: {
          tipo: 'spike',
          mensaje: msg,
          severidad: 'warn',
          meta: { count, ventana_min: SPIKE_VENTANA_MS / 60_000, umbral: SPIKE_UMBRAL },
        },
      });
    } catch (e) {
      logger.warn(`[Pipeline] No se pudo persistir alerta spike: ${e instanceof Error ? e.message : e}`);
    }

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (telegramToken && telegramChatId) {
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: msg, parse_mode: 'Markdown' }),
      }).catch((e) => console.error('[Pipeline] Error enviando alerta spike:', e));
    }
  } catch (err) {
    logger.warn(`[Pipeline] verificarSpike falló: ${err instanceof Error ? err.message : err}`);
  }
}

const PIPELINE_TIMEOUT_MS = 30_000;
const URL_FETCH_TIMEOUT_MS = 10_000;

// Cola FIFO para procesar mensajes de a uno — evita rate limit cuando llegan ráfagas
type ColaItem = { texto: string; fuente: 'whatsapp'; urlNoticia?: string; portalOrigen?: string; waMsgId?: string };
const cola: ColaItem[] = [];
let colaCorreindo = false;

async function procesarCola(): Promise<void> {
  if (colaCorreindo) return;
  colaCorreindo = true;
  while (cola.length > 0) {
    const item = cola.shift()!;
    await _procesarTexto(item.texto, item.fuente, item.urlNoticia, item.portalOrigen, item.waMsgId)
      .catch(err => logger.error('[Pipeline] Error en item de cola:', err));
  }
  colaCorreindo = false;
}

// Palabras clave del dominio — si el texto no contiene ninguna, descartarlo sin gastar quota de IA.
// Se aplica SOLO a mensajes cortos sin URL embebida. Textos largos, mensajes con URL,
// o mensajes que son solo URL siempre pasan al siguiente filtro (la IA decide).
//
// Ampliado para capturar el universo "incidentes viales y policiales" en general,
// no solo piratería del asfalto pura — Varone también quiere ver tragedias viales,
// crímenes resonantes, asaltos a choferes/conductores, estafas relacionadas, etc.
const KEYWORDS_DOMINIO = [
  // Vehículos y transporte
  'camion', 'camión', 'camiones', 'carga', 'flete', 'fletero', 'chofer', 'choferes',
  'colectivo', 'micro', 'taxi', 'cabify', 'didi', 'uber', 'remis', 'aplicación', 'aplicacion',
  'auto', 'vehículo', 'vehiculo', 'moto', 'motocicleta', 'motoquero', 'motochorro',
  'mercadería', 'mercaderia', 'contenedor', 'trailer', 'semirremolque', 'remolque', 'acoplado',
  // Delitos
  'robo', 'asalto', 'pirat', 'banda', 'delincuent', 'malvivient', 'ladrón', 'ladron',
  'crimen', 'asesin', 'masacre', 'tirote', 'ataque', 'violen', 'estafa', 'fraude',
  'tentativa', 'intento', 'sospechoso', 'sospechosa', 'detenido', 'aprehendido', 'capturado',
  'arma', 'fierro', 'disparo', 'baleado', 'herido', 'fatal', 'víctima', 'victima',
  // Geografía vial
  'ruta', 'autopista', 'autovia', 'autovía', 'acceso', 'km ', 'kilómetro', 'kilometro',
  'asfalto', 'avenida', 'calle', 'esquina', 'colectora',
  // Identificación
  'patente', 'ptte', 'placa', 'dominio',
  // Eventos viales
  'accidente', 'choque', 'colisión', 'colision', 'atropell', 'embistió', 'embistio',
  'tragedia', 'siniestro', 'incidente',
  // Autoridad
  'polic', 'comisaría', 'comisaria', 'fiscal', 'jueza', 'juez', '911',
];

function tieneKeywordDominio(texto: string): boolean {
  const lower = texto.toLowerCase();
  return KEYWORDS_DOMINIO.some(kw => lower.includes(kw));
}

// Mensaje contiene al menos una URL embebida (incluso mezclada con texto).
// Si tiene URL, asumimos que es contenido referenciado y dejamos que la IA decida.
const URL_EMBEDDED_REGEX = /https?:\/\/\S+/;

const URL_REGEX = /^https?:\/\/\S+$/;

/**
 * Si el texto contiene una URL (sola o embebida), intenta obtener el contenido
 * de la página y enriquecer. El texto original se preserva como prefijo,
 * para que la IA tenga contexto del título/descripción que el usuario escribió.
 *
 * Devuelve el texto enriquecido (texto original + contenido del artículo) o el
 * original si la URL no responde / no hay URL.
 */
async function enriquecerSiEsUrl(texto: string, urlNoticia?: string): Promise<{ texto: string; url?: string }> {
  const trimmed = texto.trim();

  // Extraer la primera URL — sea el texto entero o esté embebida en mensaje largo
  let url: string | undefined;
  if (URL_REGEX.test(trimmed)) {
    url = trimmed;
  } else {
    const match = trimmed.match(URL_EMBEDDED_REGEX);
    if (match) url = match[0];
  }

  if (!url) return { texto, url: urlNoticia };
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
      // Si el texto original era SOLO la URL, devolvemos el contenido del artículo.
      // Si tenía título/descripción además de la URL, los preservamos como contexto
      // para que la IA tenga el "framing" que escribió el usuario antes de leer el cuerpo.
      const esSoloUrl = trimmed === url;
      const enriquecido = esSoloUrl
        ? sinTags
        : `${trimmed}\n\n--- Contenido del artículo ---\n${sinTags}`;
      return { texto: enriquecido, url };
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
 * 1. Recibe texto crudo del agente WhatsApp (o de inyección manual)
 * 2. Verifica duplicados en PostgreSQL (antes de llamar a la IA para ahorrar API quota)
 * 3. Lo envía a la IA para clasificar y estructurar
 * 4. Si es nuevo y relevante, lo registra y lo envía a Framer
 */

/**
 * Encola el texto para procesamiento secuencial.
 * Evita lanzar N llamadas a la IA en paralelo cuando llegan ráfagas de mensajes.
 */
export function procesarTexto(
  texto: string,
  fuente: 'whatsapp',
  urlNoticia?: string,
  portalOrigen?: string,
  waMsgId?: string
): void {
  if (texto.trim().length < 15) return;
  cola.push({ texto, fuente, urlNoticia, portalOrigen, waMsgId });
  logger.info(`[Pipeline] Encolado (cola: ${cola.length}). Fuente: ${fuente}`);
  procesarCola();
}

async function _procesarTexto(
  texto: string,
  fuente: 'whatsapp',
  urlNoticia?: string,
  portalOrigen?: string,
  waMsgId?: string
): Promise<void> {
  try {
    incrementarMetrica('textosTotales');

    // C3: Si el mensaje es solo una URL, obtener el contenido antes de analizar
    const enriquecido = await enriquecerSiEsUrl(texto, urlNoticia);
    texto = enriquecido.texto;
    if (enriquecido.url) urlNoticia = enriquecido.url;

    // Pre-filtro léxico: descartar sin llamar a la IA si:
    //   - texto corto (<300 chars)
    //   - sin URL embebida (los mensajes con URL son contenido referenciado, dejar que IA decida)
    //   - sin keywords del dominio
    // Textos largos (>300 chars) y mensajes con URL siempre pasan a la IA.
    const tieneUrl = URL_EMBEDDED_REGEX.test(texto);
    if (texto.length < 300 && !tieneUrl && !tieneKeywordDominio(texto)) {
      incrementarMetrica('noRelevantesDescartados');
      console.log('[Pipeline] Descartado por pre-filtro léxico (corto + sin URL + sin keywords).');
      if (waMsgId) emitirEstadoProcesado(waMsgId, false);
      return;
    }

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

    // Registrar en DB. El default del schema es estado='pendiente'; lo
    // transicionamos a 'aprobado' después si el envío a Framer tiene éxito.
    const datosReporte: Record<string, unknown> = { ...reporte };
    const reporteId = await registrarReporte(texto, datosReporte);
    incrementarMetrica('reportesRegistrados');
    await verificarSpike();

    // Sprint pivot-framer-form (2026-06-26) + flow-unificado-aprobacion
    // (2026-06-28) — ya NO se auto-publica.
    //
    // Modo "review-first" unificado:
    //  - TODOS los reportes arrancan en estado='pendiente'.
    //  - Si la IA extrajo todos los campos OK → `camposFaltantes=[]` →
    //    Varone aprueba con 1 click y se publica.
    //  - Si falta ≥1 dropdown → `camposFaltantes=[...]` → la card de
    //    /aprobacion los muestra inline con select amber, el botón
    //    "Aprobar" queda disabled hasta que Varone los complete.
    //
    // El `registrarReporte()` ya setea estado='pendiente' siempre. Acá solo
    // logueamos cuántos faltantes tiene para visibilidad operativa.
    const reporteDb = await prisma.reporte.findUnique({ where: { id: reporteId } });
    const cantFaltantes = reporteDb?.camposFaltantes?.length ?? 0;

    if (cantFaltantes > 0) {
      logger.warn(
        `[Pipeline] Reporte #${reporteId} en pendiente con ${cantFaltantes} dropdowns sin resolver: ${reporteDb!.camposFaltantes.join(', ')}. Varone tiene que completar antes de aprobar.`,
      );
    } else {
      logger.info(
        `[Pipeline] Reporte #${reporteId} en pendiente — todos los campos OK, esperando aprobación de Varone.`,
      );
    }

    if (waMsgId) emitirEstadoProcesado(waMsgId, true, { gravedad: reporte.gravedad, ubicacion: reporte.ubicacion });
    console.log(`[Pipeline] Procesado: ${reporte.tipoIncidente} en ${reporte.ubicacion} (${fuente}, estado=pendiente, faltantes=${cantFaltantes})`);
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
      // Sprint pivot-framer-form (2026-06-26): firma nueva — solo reporteId.
      // El publisher lee los campos directo de DB.
      // Solo retry reportes ya aprobados (Varone OK) que están en
      // 'fallo_publicacion'. NO reintenta pendientes — eso requiere acción humana.
      if (r.estado !== 'aprobado' && r.estado !== 'fallo_publicacion') {
        continue;
      }
      const result = await enviarAFramer(r.id);
      if (result.ok) {
        logger.info(`[Pipeline] Retry exitoso: reporte #${r.id} publicado en form Framer.`);
      } else {
        logger.warn(`[Pipeline] Retry falló reporte #${r.id}: ${result.error}`);
      }
    }
  } finally {
    reintentandoFramer = false;
  }
}
