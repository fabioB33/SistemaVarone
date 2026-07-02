/**
 * Sprint pivot-framer-form (2026-06-26) — Cliente del framer-publisher v2.
 *
 * Llama al microservicio Playwright que postea al formulario público
 * https://pirateriadecamiones.com.ar/formulario-de-incidentes
 *
 * Reemplaza la integración v1 que iba contra Framer Server API + Collection
 * "Notas". Esa Collection ya no se usa.
 *
 * Endpoints consumidos:
 *  POST {FRAMER_PUBLISHER_URL}/noticia   postea 1 reporte al form
 *  GET  {FRAMER_PUBLISHER_URL}/health    healthcheck sesión
 */

import logger from './logger';
import { ENV } from '../config/env';
import { NOMBRE_AGENTE_REPORTE } from '../config/enums-framer';
import { marcarFramerEnviado, incrementarIntentosFramer } from './dedup';
import prisma from './prisma';

const REQUEST_TIMEOUT_MS = 180_000; // 3 min — el form fill con Playwright puede tardar

interface PublisherResponse {
  ok?: boolean;
  error?: string;
  urlFinal?: string;
  mensajeConfirmacion?: string;
  faltantes?: string[];
}

/**
 * Postea 1 reporte de la DB al formulario público.
 *
 * Si el reporte tiene `camposFaltantes` con entries, NO se publica:
 * retorna {ok: false, error: 'campos faltantes'} sin contactar al publisher.
 *
 * Si todos los campos están completos, lo manda al publisher con Playwright.
 *
 * Si el publisher responde {ok: true}, actualiza el reporte en DB:
 *  estado=publicado + framerEnviado=true + framerItemId=urlFinal.
 *
 * Si falla, incrementa framerIntentos y deja el reporte en estado=fallo_publicacion.
 */
export async function enviarAFramer(reporteId: number): Promise<{ ok: boolean; error?: string }> {
  if (!ENV.FRAMER_PUBLISHER_URL) {
    logger.warn('[Framer] FRAMER_PUBLISHER_URL no configurado.');
    return { ok: false, error: 'FRAMER_PUBLISHER_URL no configurado' };
  }

  const reporte = await prisma.reporte.findUnique({ where: { id: reporteId } });
  if (!reporte) {
    return { ok: false, error: `Reporte ${reporteId} no encontrado` };
  }

  // Pre-validar: si tiene camposFaltantes, no se publica.
  if (reporte.camposFaltantes && reporte.camposFaltantes.length > 0) {
    return {
      ok: false,
      error: `Reporte ${reporteId} tiene ${reporte.camposFaltantes.length} campos faltantes (${reporte.camposFaltantes.join(', ')}). Varone debe completarlos antes.`,
    };
  }

  // Validación de los 13 campos obligatorios + descripción del hecho.
  const camposNulos: string[] = [];
  const required = [
    'provincia',
    'tipoIncidenteFramer',
    'fuerzaInterviniente',
    'tipoVehiculo',
    'cargaTransportada',
    'modusOperandi',
    'huboViolencia',
    'tipoVehiculoInvolucrado',
    'cantidadVehiculosInvolucrados',
    'cantidadPersonasInvolucradas',
  ] as const;
  for (const k of required) {
    if (!reporte[k]) camposNulos.push(k);
  }
  if (camposNulos.length > 0) {
    return {
      ok: false,
      error: `Campos null en DB: ${camposNulos.join(', ')}`,
    };
  }

  const body = {
    nombreYApellido: NOMBRE_AGENTE_REPORTE,
    fechaIncidente: reporte.fecha,
    horaIncidente: reporte.hora && reporte.hora !== 'desconocida' ? reporte.hora : null,
    provincia: reporte.provincia!,
    direccionLocalidad: reporte.ubicacion,
    tipoIncidenteFramer: reporte.tipoIncidenteFramer!,
    fuerzaInterviniente: reporte.fuerzaInterviniente!,
    tipoVehiculo: reporte.tipoVehiculo!,
    cargaTransportada: reporte.cargaTransportada!,
    modusOperandi: reporte.modusOperandi!,
    huboViolencia: reporte.huboViolencia!,
    tipoVehiculoInvolucrado: reporte.tipoVehiculoInvolucrado!,
    cantidadVehiculosInvolucrados: reporte.cantidadVehiculosInvolucrados!,
    cantidadPersonasInvolucradas: reporte.cantidadPersonasInvolucradas!,
    descripcionDelHecho: reporte.descripcion,
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ENV.FRAMER_PUBLISHER_TOKEN) {
      headers['X-Publisher-Token'] = ENV.FRAMER_PUBLISHER_TOKEN;
    }

    let resp: PublisherResponse;
    try {
      const res = await fetch(`${ENV.FRAMER_PUBLISHER_URL}/noticia`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      resp = (await res.json().catch(() => ({}))) as PublisherResponse;
      if (!res.ok) {
        await incrementarIntentosFramer(reporteId);
        return { ok: false, error: `HTTP ${res.status}: ${resp.error || 'unknown'}` };
      }
    } finally {
      clearTimeout(timer);
    }

    if (resp.ok) {
      await marcarFramerEnviado(reporteId);
      await prisma.reporte.update({
        where: { id: reporteId },
        data: {
          estado: 'publicado',
          framerItemId: resp.urlFinal || null,
          // Sprint flujo-errores-editables (2026-06-30): éxito → limpiar error previo.
          framerLastError: null,
          framerLastErrorField: null,
          framerLastErrorValue: null,
        },
      });
      logger.info(`[Framer] Reporte ${reporteId} publicado en form. URL=${resp.urlFinal}`);
      return { ok: true };
    } else {
      await incrementarIntentosFramer(reporteId);
      // Sprint flujo-errores-editables (2026-06-30): parsear y persistir
      // el error para que la UI pueda resaltar el campo culpable.
      const { parseFramerError } = await import('./framer-error-parser');
      const parsed = parseFramerError(resp.error);
      await prisma.reporte.update({
        where: { id: reporteId },
        data: {
          estado: 'fallo_publicacion',
          framerLastError: parsed.raw || null,
          framerLastErrorField: parsed.fieldKey,
          framerLastErrorValue: parsed.attemptedValue,
        },
      });
      logger.error(`[Framer] Publisher devolvió error: ${resp.error}`);
      return { ok: false, error: resp.error || 'sin mensaje' };
    }
  } catch (error) {
    await incrementarIntentosFramer(reporteId);
    const msg = error instanceof Error ? error.message : String(error);
    // Sprint flujo-errores-editables: también persistimos el error de excepción
    // (publisher caído, timeout, etc.). El parser retorna campos null si no
    // matchea el shape canonical — sigue siendo útil mostrar el raw.
    const { parseFramerError } = await import('./framer-error-parser');
    const parsed = parseFramerError(msg);
    await prisma.reporte.update({
      where: { id: reporteId },
      data: {
        framerLastError: parsed.raw || null,
        framerLastErrorField: parsed.fieldKey,
        framerLastErrorValue: parsed.attemptedValue,
      },
    }).catch(() => {});
    logger.error(`[Framer] Error llamando al publisher: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Healthcheck del publisher: ¿está vivo + sesión válida?
 */
export async function healthcheckPublisher(): Promise<{ alive: boolean; logged: boolean; error?: string }> {
  if (!ENV.FRAMER_PUBLISHER_URL) {
    return { alive: false, logged: false, error: 'FRAMER_PUBLISHER_URL no configurado' };
  }
  try {
    const headers: Record<string, string> = {};
    if (ENV.FRAMER_PUBLISHER_TOKEN) {
      headers['X-Publisher-Token'] = ENV.FRAMER_PUBLISHER_TOKEN;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(`${ENV.FRAMER_PUBLISHER_URL}/health`, { headers, signal: ctrl.signal });
      const j = await res.json().catch(() => ({}));
      return j as { alive: boolean; logged: boolean; error?: string };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      alive: false,
      logged: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Sprint mejoras-flujo (2026-06-30): publicarSitio() eliminada.
// Era no-op desde el pivot v2 (jun 26). Todos sus callers fueron
// removidos en este sprint.
