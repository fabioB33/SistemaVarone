/**
 * Cliente del microservicio framer-publisher.
 *
 * El SDK oficial (framer-api) es ESM-only y vive en /framer-publisher.
 * Acá hablamos por HTTP al microservicio para mantener este módulo en
 * CommonJS y no romper el resto del Sistema Varone.
 *
 * Endpoints consumidos:
 *  POST {FRAMER_PUBLISHER_URL}/noticia   crea 1 item en draft
 *  POST {FRAMER_PUBLISHER_URL}/publish   publica el sitio (deploy)
 */

import logger from './logger';
import { ENV } from '../config/env';
import { ReporteIncidente } from '../types';
import { marcarFramerEnviado, incrementarIntentosFramer } from './dedup';

const REQUEST_TIMEOUT_MS = 30_000;

interface PublisherResponse {
  ok?: boolean;
  itemId?: string;
  slug?: string;
  count?: number;
  imageUrl?: string | null;
  error?: string;
}

interface SendOptions {
  /** Si true, también dispara publish del sitio luego de crear. Default false. */
  publishSite?: boolean;
}

function buildTitle(reporte: ReporteIncidente): string {
  const tipo = reporte.tipoIncidente?.replace(/_/g, ' ');
  const ubic = reporte.ubicacion?.trim();
  const ruta = reporte.ruta?.trim();
  const partes = [tipo, ubic, ruta].filter(Boolean);
  return partes.join(' — ').slice(0, 200) || 'Reporte de incidente';
}

function buildContent(reporte: ReporteIncidente): string {
  const lines: string[] = [];
  lines.push(`<p>${escapeHtml(reporte.descripcion)}</p>`);
  const meta: string[] = [];
  if (reporte.fecha) meta.push(`<strong>Fecha:</strong> ${escapeHtml(reporte.fecha)}`);
  if (reporte.hora) meta.push(`<strong>Hora:</strong> ${escapeHtml(reporte.hora)}`);
  if (reporte.ubicacion) meta.push(`<strong>Ubicación:</strong> ${escapeHtml(reporte.ubicacion)}`);
  if (reporte.ruta) meta.push(`<strong>Ruta:</strong> ${escapeHtml(reporte.ruta)}`);
  if (reporte.tipoIncidente) meta.push(`<strong>Tipo:</strong> ${escapeHtml(reporte.tipoIncidente)}`);
  if (reporte.gravedad) meta.push(`<strong>Gravedad:</strong> ${escapeHtml(reporte.gravedad)}`);
  if (reporte.vehiculo) meta.push(`<strong>Vehículo:</strong> ${escapeHtml(reporte.vehiculo)}`);
  if (reporte.patente) meta.push(`<strong>Patente:</strong> ${escapeHtml(reporte.patente)}`);
  if (reporte.victimas) meta.push(`<strong>Víctimas:</strong> ${escapeHtml(reporte.victimas)}`);
  if (reporte.detenidos) meta.push(`<strong>Detenidos:</strong> ${escapeHtml(reporte.detenidos)}`);
  if (meta.length) lines.push(`<p>${meta.join('<br/>')}</p>`);
  if (reporte.urlNoticia) {
    lines.push(`<p><a href="${escapeHtml(reporte.urlNoticia)}">Fuente original</a></p>`);
  }
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function postPublisher<T extends PublisherResponse>(
  path: string,
  body: unknown,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ENV.FRAMER_PUBLISHER_TOKEN) {
      headers['X-Publisher-Token'] = ENV.FRAMER_PUBLISHER_TOKEN;
    }
    const res = await fetch(`${ENV.FRAMER_PUBLISHER_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${json.error || res.statusText}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envía un reporte al microservicio framer-publisher para crear un item
 * en la Collection "Notas". Por default no publica el sitio (queda en draft).
 *
 * Devuelve el itemId de Framer si tuvo éxito, o null si falló.
 */
export async function enviarAFramer(
  reporte: ReporteIncidente,
  reporteId?: number,
  options: SendOptions = {},
): Promise<{ itemId: string; slug: string } | null> {
  if (!ENV.FRAMER_PUBLISHER_URL) {
    logger.warn('[Framer] FRAMER_PUBLISHER_URL no configurado, saltando envío.');
    return null;
  }

  const title = buildTitle(reporte);
  const content = buildContent(reporte);
  const link = reporte.urlNoticia || '';

  if (!link) {
    logger.warn('[Framer] Reporte sin urlNoticia — Framer requiere link, saltando envío.');
    return null;
  }

  try {
    const resp = await postPublisher('/noticia', {
      title,
      link,
      date: reporte.fecha || new Date().toISOString().slice(0, 10),
      content,
      metaDescription: reporte.descripcion?.slice(0, 160) || title,
      autoOgImage: true,
      featured: false,
    });

    if (!resp.ok || !resp.itemId || !resp.slug) {
      logger.error(`[Framer] Publisher devolvió respuesta inválida: ${JSON.stringify(resp)}`);
      if (reporteId) await incrementarIntentosFramer(reporteId);
      return null;
    }

    logger.info(
      `[Framer] Item creado: id=${resp.itemId} slug=${resp.slug} count=${resp.count}` +
        (resp.imageUrl ? ' (con imagen OG)' : ''),
    );

    if (options.publishSite) {
      try {
        await postPublisher('/publish', {});
        logger.info('[Framer] Sitio re-publicado tras la inserción.');
      } catch (err) {
        logger.error('[Framer] Falló publish del sitio (item ya creado):', err);
      }
    }

    if (reporteId) await marcarFramerEnviado(reporteId);
    return { itemId: resp.itemId, slug: resp.slug };
  } catch (error) {
    logger.error('[Framer] Error llamando al publisher:', error);
    if (reporteId) await incrementarIntentosFramer(reporteId);
    return null;
  }
}

/**
 * Dispara un publish del sitio sin crear nada nuevo.
 * Útil para el cron diario y el botón "Publicar ahora" del dashboard.
 */
export async function publicarSitio(): Promise<{ deploymentId: string } | null> {
  try {
    const resp = (await postPublisher('/publish', {})) as PublisherResponse & {
      deploymentId?: string;
    };
    if (!resp.ok || !resp.deploymentId) {
      logger.error(`[Framer] Publish devolvió respuesta inválida: ${JSON.stringify(resp)}`);
      return null;
    }
    logger.info(`[Framer] Sitio publicado: deploymentId=${resp.deploymentId}`);
    return { deploymentId: resp.deploymentId };
  } catch (error) {
    logger.error('[Framer] Error en publicarSitio:', error);
    return null;
  }
}
