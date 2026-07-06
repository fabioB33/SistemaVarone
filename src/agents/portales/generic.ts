/**
 * Sprint portales-custom (2026-07-06) — Scraper genérico configurable.
 *
 * Usado por los portales que Varone agrega desde el panel /configuracion.
 * A diferencia de los 6 hardcoded (clarin.ts, cronica.ts, etc.) que tienen
 * selectores CSS específicos escritos a mano, este scraper toma los selectores
 * del row de DB (`portales_custom`) y los aplica genéricamente.
 *
 * CONTRATO:
 *  - `cardSelector` (obligatorio): CSS que matchea los contenedores de cada nota
 *    en la portada de la sección. Ejemplo: 'article', '.card-nota', '.news-item'.
 *  - `linkSelector` (opcional): CSS del anchor DENTRO de cada card. Si no se da,
 *    tomamos el primer <a[href]> del card.
 *  - `titleSelector` (opcional): CSS del título DENTRO de cada card. Si no se da,
 *    usamos el textContent del anchor.
 *
 * REALIDAD TÉCNICA (regla #1 SIN ATAJOS):
 *  Este scraper funciona bien para portales SSR o con HTML pre-hidratación
 *  (Diario Popular, Crónica, sitios chicos). Para SPA modernos que hidratan
 *  en cliente (Infobae, muchos portales React), el HTML inicial NO tiene las
 *  cards → el scraper trae 0 notas. Ese es un límite inherente del fetch HTML
 *  sin JavaScript. Los portales complicados siguen requiriendo scraper
 *  hand-crafted (o cambiar a Playwright para renderear JS, cosa que NO
 *  hacemos acá por costo de recursos).
 *
 * SEGURIDAD:
 *  - `cardSelector` viene del panel → validamos que no sea vacío ni "too big"
 *    (max 500 chars). No previene selectores raros pero limita XSS-como-CSS.
 *  - No ejecutamos JavaScript del portal — solo parseamos HTML crudo.
 */

import { ENV } from '../../config/env';
import logger from '../../services/logger';
import { fetchHtml } from './lib/http';
import { absoluteUrl, limpiarResumen, parseDocument } from './lib/parser';
import type { NotaScrapeada, PortalScraper } from './types';

export interface PortalCustomConfig {
  slug: string;          // 'la-voz-interior'
  nombre: string;        // 'La Voz del Interior'
  url: string;           // 'https://www.lavoz.com.ar/sucesos/'
  cardSelector: string;
  linkSelector?: string | null;
  titleSelector?: string | null;
}

/**
 * Construye un `PortalScraper` a partir de la config guardada en DB.
 */
export function buildGenericScraper(cfg: PortalCustomConfig): PortalScraper {
  return {
    nombre: cfg.slug,
    url: cfg.url,

    async scrape(): Promise<NotaScrapeada[]> {
      try {
        // Validaciones básicas — si el operador pegó basura, fallamos rápido.
        if (!cfg.cardSelector || cfg.cardSelector.length > 500) {
          logger.warn(`[portales/custom/${cfg.slug}] cardSelector inválido, skip`);
          return [];
        }

        const { body } = await fetchHtml(cfg.url);
        const { all } = parseDocument(body);

        const cards = all(cfg.cardSelector);
        if (cards.length === 0) {
          logger.warn(
            `[portales/custom/${cfg.slug}] cardSelector "${cfg.cardSelector}" no matcheó nada. ` +
              `¿El portal cambió el HTML o usa React?`,
          );
          return [];
        }

        const base = new URL(cfg.url).origin;
        const seen = new Set<string>();
        const notas: NotaScrapeada[] = [];

        for (const card of cards) {
          // Link: usar el selector si vino, o el primer <a[href]>
          const linkEl = cfg.linkSelector
            ? card.querySelector(cfg.linkSelector)
            : card.querySelector('a[href]');
          const href = linkEl?.getAttribute('href') || '';
          if (!href) continue;

          const url = absoluteUrl(href, base);
          if (!url || seen.has(url)) continue;
          seen.add(url);

          // Título: selector propio o textContent del link
          const tituloEl = cfg.titleSelector ? card.querySelector(cfg.titleSelector) : null;
          const titulo = (tituloEl?.textContent || linkEl?.textContent || '').trim();
          if (!titulo || titulo.length < 10) continue;

          notas.push({
            portal: cfg.slug,
            url,
            titulo,
            resumen: limpiarResumen(titulo, 600), // sin resumen específico, usamos el titular
            publishedAt: null,
          });

          if (notas.length >= ENV.SCRAPER_MAX_NOTAS_POR_PORTAL) break;
        }

        if (notas.length === 0) {
          logger.warn(
            `[portales/custom/${cfg.slug}] ${cards.length} cards matcheadas pero 0 notas extraíbles`,
          );
        } else {
          logger.info(`[portales/custom/${cfg.slug}] ${notas.length} notas extraídas`);
        }
        return notas;
      } catch (err) {
        logger.error(
          `[portales/custom/${cfg.slug}] error: ${err instanceof Error ? err.message : err}`,
        );
        return [];
      }
    },
  };
}

/**
 * Corre UN scrape de prueba con la config dada, SIN persistir en DB. Usado
 * por el endpoint POST /probar-scraper del panel: Varone completa el form
 * y ANTES de guardar, ve cuántas notas trae.
 *
 * Retorna una preview con:
 *  - cuántas cards matcheó el selector
 *  - cuántas notas extrajo (con título y link válidos)
 *  - los primeros 5 títulos como sample
 *  - error si algo falló
 */
export interface ProbarResultado {
  ok: boolean;
  cardsMatcheadas: number;
  notasExtraidas: number;
  primeras: Array<{ titulo: string; url: string }>;
  error?: string;
}

export async function probarScraperGenerico(cfg: PortalCustomConfig): Promise<ProbarResultado> {
  try {
    if (!cfg.url || !cfg.cardSelector) {
      return {
        ok: false,
        cardsMatcheadas: 0,
        notasExtraidas: 0,
        primeras: [],
        error: 'url y cardSelector son obligatorios',
      };
    }

    const { body } = await fetchHtml(cfg.url);
    const { all } = parseDocument(body);
    const cards = all(cfg.cardSelector);

    const scraper = buildGenericScraper(cfg);
    const notas = await scraper.scrape();

    return {
      ok: true,
      cardsMatcheadas: cards.length,
      notasExtraidas: notas.length,
      primeras: notas.slice(0, 5).map((n) => ({ titulo: n.titulo, url: n.url })),
    };
  } catch (err) {
    return {
      ok: false,
      cardsMatcheadas: 0,
      notasExtraidas: 0,
      primeras: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
