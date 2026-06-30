/**
 * Sprint scrapers-portales (2026-06-30) — Orchestrator de scrapers.
 *
 * Para cada portal:
 *  1. Scrapea la portada de su sección policial
 *  2. Pre-filtra cada nota (whitelist/blacklist)
 *  3. Los descartes los guarda en `scrapes_descartados` (auditoría)
 *  4. Los que pasan los manda al pipeline existente (services/pipeline.ts) que
 *     ya tiene IA + retries + dedup + enum-matcher + DB
 *
 * Diseño:
 *  - Cada scraper es independiente. Si Clarín rompe, los otros siguen.
 *  - El orchestrator es invocable manualmente (ej. desde un endpoint admin
 *    para "correr ahora un portal X") o por cron schedule.
 */

import logger from '../../services/logger';
import { preFiltrar } from '../../services/prefiltro';
import { procesarTexto } from '../../services/pipeline';
import prisma from '../../services/prisma';
import { cronicaScraper } from './cronica';
import { diarioPopularScraper } from './diario-popular';
import { infobaeScraper } from './infobae';
import { laNacionScraper } from './la-nacion';
import { clarinScraper } from './clarin';
import { pagina12Scraper } from './pagina12';
import type { NotaScrapeada, PortalScraper } from './types';

export const SCRAPERS: Record<string, PortalScraper> = {
  cronica: cronicaScraper,
  'diario-popular': diarioPopularScraper,
  infobae: infobaeScraper,
  'la-nacion': laNacionScraper,
  clarin: clarinScraper,
  pagina12: pagina12Scraper,
};

export interface CorridaResultado {
  portal: string;
  notasScrapeadas: number;
  pasaronPrefiltro: number;
  descartadosBlacklist: number;
  descartadosSinKeywords: number;
  enviadosAlPipeline: number;
  duracionMs: number;
}

/**
 * Corre 1 scraper completo + procesa cada nota.
 * Función EXPORTADA porque el endpoint admin "correr ahora" la invoca.
 */
export async function correrScraperUno(portal: string): Promise<CorridaResultado> {
  const scraper = SCRAPERS[portal];
  if (!scraper) {
    throw new Error(`Portal desconocido: ${portal}. Válidos: ${Object.keys(SCRAPERS).join(', ')}`);
  }

  const t0 = Date.now();
  const notas = await scraper.scrape();
  let pasaronPrefiltro = 0;
  let descartadosBlacklist = 0;
  let descartadosSinKeywords = 0;
  let enviadosAlPipeline = 0;

  for (const nota of notas) {
    const textoEvaluacion = `${nota.titulo}. ${nota.resumen}`.trim();
    const filtro = preFiltrar(textoEvaluacion, nota.titulo);

    if (!filtro.pasa) {
      if (filtro.razon === 'blacklist') descartadosBlacklist++;
      else descartadosSinKeywords++;
      await guardarDescarte(nota, filtro.razon, filtro.matchedKeywords);
      continue;
    }

    pasaronPrefiltro++;
    // Mandar al pipeline existente. El pipeline se encarga de: IA → dedup → DB.
    procesarTexto(textoEvaluacion, 'scraping', {
      urlNoticia: nota.url,
      portalOrigen: nota.portal,
      tituloOriginal: nota.titulo,
      publishedAt: nota.publishedAt,
    });
    enviadosAlPipeline++;
  }

  const duracionMs = Date.now() - t0;
  logger.info(
    `[portales/${portal}] notas=${notas.length} prefiltroOK=${pasaronPrefiltro} ` +
      `descBL=${descartadosBlacklist} descSK=${descartadosSinKeywords} ` +
      `pipeline=${enviadosAlPipeline} duracion=${duracionMs}ms`,
  );

  return {
    portal,
    notasScrapeadas: notas.length,
    pasaronPrefiltro,
    descartadosBlacklist,
    descartadosSinKeywords,
    enviadosAlPipeline,
    duracionMs,
  };
}

/**
 * Corre TODOS los scrapers en paralelo. Usado por el cron diario.
 */
export async function correrTodosLosScrapers(): Promise<CorridaResultado[]> {
  logger.info(`[portales] iniciando corrida de ${Object.keys(SCRAPERS).length} portales en paralelo`);
  const promises = Object.keys(SCRAPERS).map((p) =>
    correrScraperUno(p).catch((err) => {
      logger.error(`[portales/${p}] excepción no manejada: ${err instanceof Error ? err.message : err}`);
      return {
        portal: p,
        notasScrapeadas: 0,
        pasaronPrefiltro: 0,
        descartadosBlacklist: 0,
        descartadosSinKeywords: 0,
        enviadosAlPipeline: 0,
        duracionMs: 0,
      };
    }),
  );
  return Promise.all(promises);
}

async function guardarDescarte(nota: NotaScrapeada, razon: string, matchedKeywords: string[]): Promise<void> {
  try {
    await prisma.scrapeDescartado.upsert({
      where: {
        portal_url: { portal: nota.portal, url: nota.url },
      },
      create: {
        portal: nota.portal,
        url: nota.url,
        titulo: nota.titulo,
        resumen: nota.resumen,
        razon,
        matchedKeywords,
      },
      update: {
        // si vuelve a aparecer, refrescamos timestamp para mostrar "vivo"
        descartadoEn: new Date(),
        matchedKeywords,
      },
    });
  } catch (err) {
    logger.warn(`[portales] error guardando descarte: ${err instanceof Error ? err.message : err}`);
  }
}
