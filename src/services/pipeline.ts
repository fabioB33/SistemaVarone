import { analizarConIA } from './ia';
import { existeDuplicado, registrarReporte, obtenerPendientesFramer } from './dedup';
import { enviarAFramer } from './framer';
import { incrementarMetrica } from '../dashboard/server';
import { ReporteIncidente } from '../types';

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
  portalOrigen?: string
): Promise<void> {
  if (texto.trim().length < 15) return;

  try {
    incrementarMetrica('textosTotales');

    // C3: Si el mensaje es solo una URL, obtener el contenido antes de analizar
    const enriquecido = await enriquecerSiEsUrl(texto, urlNoticia);
    texto = enriquecido.texto;
    if (enriquecido.url) urlNoticia = enriquecido.url;

    // Verificar duplicado antes de llamar a la IA para ahorrar quota de API
    const esDuplicado = await existeDuplicado(texto);
    if (esDuplicado) {
      incrementarMetrica('duplicadosDescartados');
      console.log('[Pipeline] Duplicado detectado, ignorando.');
      return;
    }

    const resultado = await conTimeout(analizarConIA(texto), PIPELINE_TIMEOUT_MS, 'analizarConIA');

    if (!resultado.esRelevante || !resultado.reporte) {
      incrementarMetrica('noRelevantesDescartados');
      console.log(`[Pipeline] Descartado (no relevante) - fuente: ${fuente}`);
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

    // Enviar a Framer pasando el id para actualizar el flag
    const framerOk = await enviarAFramer(reporte, reporteId);
    incrementarMetrica(framerOk ? 'framerEnviados' : 'framerFallidos');

    console.log(`[Pipeline] Procesado: ${reporte.tipoIncidente} en ${reporte.ubicacion} (${fuente})`);
  } catch (error) {
    console.error(`[Pipeline] Error procesando texto (${fuente}):`, error);
  }
}

/**
 * Reintenta enviar a Framer los reportes que fallaron.
 * Se ejecuta periódicamente desde el cron.
 */
export async function reintentarFramerPendientes(): Promise<void> {
  const pendientes = await obtenerPendientesFramer();
  if (pendientes.length === 0) return;

  console.log(`[Pipeline] Reintentando ${pendientes.length} reportes pendientes de Framer...`);

  for (const r of pendientes) {
    const reporte: Partial<ReporteIncidente> = {
      fecha: r.fecha,
      hora: 'desconocida',
      ubicacion: r.ubicacion,
      ruta: r.ruta,
      tipoIncidente: r.tipoIncidente,
      gravedad: r.gravedad ?? undefined,
      descripcion: r.descripcion,
      fuente: r.fuente as 'whatsapp' | 'scraping',
      urlNoticia: r.urlNoticia ?? undefined,
      victimas: r.victimas ?? undefined,
      detenidos: r.detenidos ?? undefined,
    };
    await enviarAFramer(reporte as ReporteIncidente, r.id);
  }
}
