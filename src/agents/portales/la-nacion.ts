/**
 * Sprint scrapers-portales (2026-06-30) — Scraper La Nación.
 * Sección Seguridad: https://www.lanacion.com.ar/seguridad/
 */

import { ENV } from '../../config/env';
import logger from '../../services/logger';
import { fetchHtml } from './lib/http';
import { absoluteUrl, limpiarResumen, parseDocument } from './lib/parser';
import type { NotaScrapeada, PortalScraper } from './types';

const BASE = 'https://www.lanacion.com.ar';
const URL_SECCION = `${BASE}/seguridad/`;

export const laNacionScraper: PortalScraper = {
  nombre: 'la-nacion',
  url: URL_SECCION,

  async scrape(): Promise<NotaScrapeada[]> {
    try {
      const { body } = await fetchHtml(URL_SECCION);
      const { all, text, attr } = parseDocument(body);

      const cards = all('article, .com-article, [data-testid*="article"]');
      const notas: NotaScrapeada[] = [];

      for (const card of cards) {
        const linkEl = card.querySelector('a[href*="/seguridad/"], a[href*="/sociedad/"]');
        const url = absoluteUrl(linkEl?.getAttribute('href') || '', BASE);
        if (!url) continue;

        const titulo = (text('h2, h3, .com-title, [class*="title"]', card) || linkEl?.textContent || '').trim();
        if (!titulo || titulo.length < 10) continue;

        const resumen = limpiarResumen(text('.com-subtitle, .summary, .bajada, p', card));
        const fechaStr = attr('time', 'datetime', card) || text('time', card);
        const publishedAt = fechaStr ? new Date(fechaStr) : null;

        notas.push({
          portal: 'la-nacion',
          url,
          titulo,
          resumen,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        });

        if (notas.length >= ENV.SCRAPER_MAX_NOTAS_POR_PORTAL) break;
      }

      if (notas.length === 0) {
        logger.warn(`[portales/la-nacion] 0 notas — selectores pueden estar rotos. URL: ${URL_SECCION}`);
      } else {
        logger.info(`[portales/la-nacion] ${notas.length} notas extraídas`);
      }
      return notas;
    } catch (err) {
      logger.error(`[portales/la-nacion] error: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  },
};
