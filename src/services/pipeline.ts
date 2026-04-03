import { analizarConIA } from './ia';
import { existeDuplicado, registrarReporte, obtenerPendientesFramer } from './dedup';
import { enviarAFramer } from './framer';
import { incrementarMetrica } from '../dashboard/server';
import { ReporteIncidente } from '../types';

const PIPELINE_TIMEOUT_MS = 30_000;

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
  urlNoticia?: string
): Promise<void> {
  if (texto.trim().length < 15) return;

  try {
    incrementarMetrica('textosTotales');

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
