import { ENV } from '../config/env';
import { ReporteIncidente } from '../types';
import { marcarFramerEnviado, incrementarIntentosFramer } from './dedup';

export async function enviarAFramer(reporte: ReporteIncidente, reporteId?: number): Promise<boolean> {
  if (!ENV.FRAMER_ENDPOINT) {
    console.warn('[Framer] Endpoint no configurado, saltando envío.');
    return false;
  }

  try {
    const response = await fetch(ENV.FRAMER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: reporte.fecha,
        hora: reporte.hora,
        ubicacion: reporte.ubicacion,
        ruta: reporte.ruta,
        tipo_incidente: reporte.tipoIncidente,
        gravedad: reporte.gravedad || '',
        descripcion: reporte.descripcion,
        vehiculo: reporte.vehiculo || '',
        patente: reporte.patente || '',
        victimas: reporte.victimas || '',
        detenidos: reporte.detenidos || '',
        fuente: reporte.fuente,
        url_noticia: reporte.urlNoticia || '',
      }),
    });

    if (!response.ok) {
      console.error(`[Framer] Error HTTP ${response.status}: ${await response.text()}`);
      if (reporteId) await incrementarIntentosFramer(reporteId);
      return false;
    }

    if (reporteId) await marcarFramerEnviado(reporteId);
    console.log(`[Framer] Reporte enviado (${reporte.tipoIncidente} - ${reporte.ubicacion})`);
    return true;
  } catch (error) {
    console.error('[Framer] Error enviando reporte:', error);
    if (reporteId) await incrementarIntentosFramer(reporteId);
    return false;
  }
}
