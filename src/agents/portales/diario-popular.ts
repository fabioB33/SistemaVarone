/**
 * Sprint scrapers-portales (2026-06-30) — Scraper Diario Popular.
 * Sección policiales: https://www.diariopopular.com.ar/policiales
 */

import { ENV } from '../../config/env';
import logger from '../../services/logger';
import { fetchHtml } from './lib/http';
import { absoluteUrl, limpiarResumen, parseDocument } from './lib/parser';
import type { NotaScrapeada, PortalScraper } from './types';

const BASE = 'https://www.diariopopular.com.ar';
const URL_SECCION = `${BASE}/policiales`;

export const diarioPopularScraper: PortalScraper = {
  nombre: 'diario-popular',
  url: URL_SECCION,

  async scrape(): Promise<NotaScrapeada[]> {
    try {
      const { body } = await fetchHtml(URL_SECCION);
      const { all, text, attr } = parseDocument(body);

      const cards = all('article, .article-card, .news-card');
      const notas: NotaScrapeada[] = [];

      for (const card of cards) {
        const linkEl = card.querySelector('a[href*="/policiales/"], a[href*="/nota/"]');
        const url = absoluteUrl(linkEl?.getAttribute('href') || '', BASE);
        if (!url) continue;

        const titulo = (text('h2, h3, .title', card) || linkEl?.textContent || '').trim();
        if (!titulo || titulo.length < 10) continue;

        const resumen = limpiarResumen(text('.bajada, .summary, .desc, p', card));
        const fechaStr = attr('time', 'datetime', card) || text('time, .date', card);
        const publishedAt = fechaStr ? new Date(fechaStr) : null;

        notas.push({
          portal: 'diario-popular',
          url,
          titulo,
          resumen,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        });

        if (notas.length >= ENV.SCRAPER_MAX_NOTAS_POR_PORTAL) break;
      }

      if (notas.length === 0) {
        logger.warn(`[portales/diario-popular] 0 notas — selectores pueden estar rotos. URL: ${URL_SECCION}`);
      } else {
        logger.info(`[portales/diario-popular] ${notas.length} notas extraídas`);
      }
      return notas;
    } catch (err) {
      logger.error(`[portales/diario-popular] error: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  },
};
