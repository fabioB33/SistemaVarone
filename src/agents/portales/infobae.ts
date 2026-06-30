/**
 * Sprint scrapers-portales (2026-06-30) — Scraper Infobae.
 * Sección Policiales: https://www.infobae.com/sociedad/policiales/
 *
 * NOTA empírica (smoke real 2026-06-30): Infobae es un React app que
 * hidrata los `<article>` con JS. El HTML inicial NO tiene cards, pero SÍ
 * tiene los anchors `<a href="/sociedad/policiales/...">` en estado pre-hidratación.
 *
 * Estrategia: extraer notas DESDE los anchors directos, no del wrapper. Tomamos
 * el texto del anchor como titular (los anchors de Infobae traen el headline
 * como contenido textual).
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
      const { all } = parseDocument(body);

      // Estrategia 2026-06-30: anchors directos a notas. Los URLs siguen el patrón
      // /sociedad/policiales/YYYY/MM/DD/slug-de-la-nota/.
      const anchors = all('a[href*="/sociedad/policiales/"]');
      const seen = new Set<string>();
      const notas: NotaScrapeada[] = [];

      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        // Solo URLs que parecen notas (YYYY/MM/DD/slug) — no listings ni filtros.
        if (!/\/sociedad\/policiales\/\d{4}\/\d{2}\/\d{2}\//.test(href)) continue;
        const url = absoluteUrl(href, BASE);
        if (seen.has(url)) continue;
        seen.add(url);

        const titulo = (a.textContent || '').trim();
        if (!titulo || titulo.length < 15) continue;

        // El resumen no está en el anchor — pero el título de Infobae suele ser
        // descriptivo. Resumen vacío es OK, la IA decide con el titular.
        notas.push({
          portal: 'infobae',
          url,
          titulo,
          resumen: limpiarResumen(titulo, 600),
          publishedAt: null,
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
