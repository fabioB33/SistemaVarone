import { analizarConIA } from './ia';
import { existeDuplicado, registrarReporte, obtenerPendientesFramer } from './dedup';
import { enviarAFramer } from './framer';
import { ReporteIncidente } from '../types';

/**
 * Pipeline principal:
 * 1. Recibe texto crudo (de WA o scraper)
 * 2. Lo envía a la IA para clasificar y estructurar
 * 3. Verifica duplicados en PostgreSQL
 * 4. Si es nuevo, lo registra y lo envía a Framer
 */
export async function procesarTexto(
  texto: string,
  fuente: 'whatsapp' | 'scraping',
  urlNoticia?: string
): Promise<void> {
  if (texto.trim().length < 15) return;

  try {
    const resultado = await analizarConIA(texto);

    if (!resultado.esRelevante || !resultado.reporte) {
      console.log(`[Pipeline] Descartado (no relevante) - fuente: ${fuente}`);
      return;
    }

    const reporte = resultado.reporte;
    reporte.fuente = fuente;
    reporte.textoOriginal = texto;
    if (urlNoticia) reporte.urlNoticia = urlNoticia;

    const esDuplicado = await existeDuplicado(texto);
    if (esDuplicado) {
      console.log('[Pipeline] Duplicado detectado, ignorando.');
      return;
    }

    // Registrar en DB — obtener el id para trackear estado de Framer
    const reporteId = await registrarReporte(texto, reporte as unknown as Record<string, unknown>);

    // Enviar a Framer pasando el id para actualizar el flag
    await enviarAFramer(reporte, reporteId);

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
