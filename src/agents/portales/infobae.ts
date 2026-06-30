/**
 * Sprint scrapers-portales (2026-06-30) — Scraper Infobae.
 * Sección Sociedad / Policiales: https://www.infobae.com/sociedad/policiales/
 */

import { ENV } from '../../config/env';
import logger from '../../services/logger';
import { fetchHtml } from './lib/http';
import { absoluteUrl, limpiarResumen, parseDocument } from './lib/parser';
import type { NotaScrapeada, PortalScraper } from './types';

const BASE = 'https://www.infobae.com';
const URL_SECCION = `${BASE}/sociedad/policiales/`;

export const infobaeScraper: PortalScraper = {
  nombre: 'infobae',
  url: URL_SECCION,

  async scrape(): Promise<NotaScrapeada[]> {
    try {
      const { body } = await fetchHtml(URL_SECCION);
      const { all, text, attr } = parseDocument(body);

      // Infobae usa <article> con data-testid o clases tipo story-card
      const cards = all('article, [data-testid*="story"], .story-card, .feed-list-card');
      const notas: NotaScrapeada[] = [];

      for (const card of cards) {
        const linkEl = card.querySelector('a[href*="/sociedad/"], a[href*="/policiales/"]');
        const url = absoluteUrl(linkEl?.getAttribute('href') || '', BASE);
        if (!url) continue;

        const titulo = (text('h2, h3, .title, [class*="headline"]', card) || linkEl?.textContent || '').trim();
        if (!titulo || titulo.length < 10) continue;

        const resumen = limpiarResumen(text('.bajada, .summary, .deck, [class*="subheadline"], p', card));
        const fechaStr = attr('time', 'datetime', card) || text('time', card);
        const publishedAt = fechaStr ? new Date(fechaStr) : null;

        notas.push({
          portal: 'infobae',
          url,
          titulo,
          resumen,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        });

        if (notas.length >= ENV.SCRAPER_MAX_NOTAS_POR_PORTAL) break;
      }

      if (notas.length === 0) {
        logger.warn(`[portales/infobae] 0 notas — selectores pueden estar rotos. URL: ${URL_SECCION}`);
      } else {
        logger.info(`[portales/infobae] ${notas.length} notas extraídas`);
      }
      return notas;
    } catch (err) {
      logger.error(`[portales/infobae] error: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  },
};
