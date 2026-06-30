/**
 * Sprint scrapers-portales (2026-06-30) — Scraper Página 12.
 * Sección Sociedad: https://www.pagina12.com.ar/secciones/sociedad
 *
 * Nota: P12 no tiene sección "policiales" propiamente — la cobertura de
 * piratería del asfalto suele caer en Sociedad. Si es muy ruidoso, podemos
 * cambiar a una búsqueda por query con `q=camion+asalto`.
 */

import { ENV } from '../../config/env';
import logger from '../../services/logger';
import { fetchHtml } from './lib/http';
import { absoluteUrl, limpiarResumen, parseDocument } from './lib/parser';
import type { NotaScrapeada, PortalScraper } from './types';

const BASE = 'https://www.pagina12.com.ar';
const URL_SECCION = `${BASE}/secciones/sociedad`;

export const pagina12Scraper: PortalScraper = {
  nombre: 'pagina12',
  url: URL_SECCION,

  async scrape(): Promise<NotaScrapeada[]> {
    try {
      const { body } = await fetchHtml(URL_SECCION);
      const { all, text, attr } = parseDocument(body);

      const cards = all('article, .article-item, .item-titulo');
      const notas: NotaScrapeada[] = [];

      for (const card of cards) {
        const linkEl = card.querySelector('a[href*="/"]');
        const url = absoluteUrl(linkEl?.getAttribute('href') || '', BASE);
        if (!url) continue;

        // Filtra URLs que NO sean notas (taggers, secciones, etc.)
        if (url.includes('/tag/') || url.includes('/secciones/')) continue;

        const titulo = (text('h2, h3, .title-list, [class*="title"]', card) || linkEl?.textContent || '').trim();
        if (!titulo || titulo.length < 10) continue;

        const resumen = limpiarResumen(text('.bajada, .volanta, .summary, p', card));
        const fechaStr = attr('time', 'datetime', card) || text('time', card);
        const publishedAt = fechaStr ? new Date(fechaStr) : null;

        notas.push({
          portal: 'pagina12',
          url,
          titulo,
          resumen,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        });

        if (notas.length >= ENV.SCRAPER_MAX_NOTAS_POR_PORTAL) break;
      }

      if (notas.length === 0) {
        logger.warn(`[portales/pagina12] 0 notas — selectores pueden estar rotos. URL: ${URL_SECCION}`);
      } else {
        logger.info(`[portales/pagina12] ${notas.length} notas extraídas`);
      }
      return notas;
    } catch (err) {
      logger.error(`[portales/pagina12] error: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  },
};
