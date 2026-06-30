/**
 * Sprint scrapers-portales (2026-06-30) — Scraper Página 12.
 * Sección Sociedad: https://www.pagina12.com.ar/secciones/sociedad
 *
 * NOTA empírica (smoke real 2026-06-30): P12 NO usa <article>. Su sistema es
 * `.p12-article-card-full` con `.c-link` adentro como anchor. Los headlines
 * vienen como hijo del anchor con tags h2/h3.
 *
 * P12 no tiene sección "policiales" propia — los hechos de piratería caen en
 * Sociedad. El pre-filtro descarta lo no relevante.
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
      const { all } = parseDocument(body);

      // Estrategia 2026-06-30: P12 usa `.p12-article-card-full` + `.c-link`.
      // Fallback: cualquier anchor a /YYYY-MM/.../ (formato URL de notas).
      const cards = all('.p12-article-card-full, .p12-wrapper-article-card, article');
      const seen = new Set<string>();
      const notas: NotaScrapeada[] = [];

      for (const card of cards) {
        const linkEl = card.querySelector('a.c-link, a[href*="/"]');
        const href = linkEl?.getAttribute('href') || '';
        if (!href) continue;

        // Filtra URLs no-nota
        if (href.includes('/tag/') || href.includes('/secciones/') || href.includes('#')) continue;

        const url = absoluteUrl(href, BASE);
        if (seen.has(url)) continue;
        seen.add(url);

        // Título: h2/h3 si existe, sino el texto del anchor
        const tituloEl = card.querySelector('h1, h2, h3, .p12-article-card-full--title');
        const titulo = (tituloEl?.textContent || linkEl?.textContent || '').trim();
        if (!titulo || titulo.length < 10) continue;

        const resumenEl = card.querySelector('.p12-article-card-full--bajada, .bajada, .epigraph');
        const resumen = limpiarResumen(resumenEl?.textContent || '');

        notas.push({
          portal: 'pagina12',
          url,
          titulo,
          resumen,
          publishedAt: null,
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
