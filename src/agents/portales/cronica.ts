/**
 * Sprint scrapers-portales (2026-06-30) — Scraper Crónica.
 *
 * Sección policiales: https://www.cronica.com.ar/seccion/policiales
 *
 * Estrategia (defensiva — los portales cambian el HTML):
 *  1. Intentamos selectores DOM canónicos primero.
 *  2. Si la portada no devuelve resultados, log warn y retornamos [] (healthcheck
 *     se va a quejar al día siguiente).
 *  3. Para cada nota, intentamos extraer URL absoluta + título + bajada/copete.
 *  4. NO entramos a la nota individual (eso es Sprint+1 si necesitamos el cuerpo).
 *     Por ahora el resumen del listing alcanza para que la IA decida si es del nicho.
 */

import { ENV } from '../../config/env';
import logger from '../../services/logger';
import { fetchHtml } from './lib/http';
import { absoluteUrl, limpiarResumen, parseDocument } from './lib/parser';
import type { NotaScrapeada, PortalScraper } from './types';

const BASE = 'https://www.cronica.com.ar';
const URL_SECCION = `${BASE}/seccion/policiales`;

export const cronicaScraper: PortalScraper = {
  nombre: 'cronica',
  url: URL_SECCION,

  async scrape(): Promise<NotaScrapeada[]> {
    try {
      const { body } = await fetchHtml(URL_SECCION);
      const { all, text, attr } = parseDocument(body);

      // Selector defensivo: artículos con link a /policiales/. Crónica usa
      // <article> con anchor anidado.
      const cards = all('article, .card, .news-item');
      const notas: NotaScrapeada[] = [];

      for (const card of cards) {
        const linkEl = card.querySelector('a[href*="/policiales/"], a[href*="/seccion/policiales/"]');
        const url = absoluteUrl(linkEl?.getAttribute('href') || '', BASE);
        if (!url) continue;

        // Heurística: título es el primer texto largo del card (>20 chars).
        const titulo = (linkEl?.textContent || text('h2, h3', card)).trim();
        if (!titulo || titulo.length < 10) continue;

        // Bajada/copete opcional
        const bajada = text('.bajada, .copete, .summary, p', card);
        const resumen = limpiarResumen(bajada);

        // Fecha si está en el card
        const fechaStr = attr('time', 'datetime', card) || text('time', card);
        const publishedAt = fechaStr ? new Date(fechaStr) : null;

        notas.push({
          portal: 'cronica',
          url,
          titulo,
          resumen,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        });

        if (notas.length >= ENV.SCRAPER_MAX_NOTAS_POR_PORTAL) break;
      }

      if (notas.length === 0) {
        logger.warn(`[portales/cronica] 0 notas extraídas — selectores pueden estar rotos. URL: ${URL_SECCION}`);
      } else {
        logger.info(`[portales/cronica] ${notas.length} notas extraídas`);
      }
      return notas;
    } catch (err) {
      logger.error(`[portales/cronica] error: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  },
};
