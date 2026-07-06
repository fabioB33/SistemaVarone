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
import { buildGenericScraper } from './generic';
import { obtenerPortalesCustomActivos, marcarUltimoScrapeOk } from '../../services/portales-custom';
import type { NotaScrapeada, PortalScraper } from './types';

/**
 * Scrapers HARDCODED (6 portales built-in con selectores CSS específicos escritos
 * a mano). No cambian sin nuevo deploy.
 */
const SCRAPERS_HARDCODED: Record<string, PortalScraper> = {
  cronica: cronicaScraper,
  'diario-popular': diarioPopularScraper,
  infobae: infobaeScraper,
  'la-nacion': laNacionScraper,
  clarin: clarinScraper,
  pagina12: pagina12Scraper,
};

/**
 * Cache de portales custom (agregados por Varone desde /configuracion). Se
 * refresca cada CUSTOM_REFRESH_MS. Al hacer merge con hardcoded, dan la lista
 * canonical de scrapers disponibles.
 */
let scrapersCustomCache: Record<string, PortalScraper> = {};
let scrapersCustomLastFetch = 0;
const CUSTOM_REFRESH_MS = 5 * 60 * 1000; // 5 min

async function refrescarScrapersCustom(): Promise<void> {
  try {
    const activos = await obtenerPortalesCustomActivos();
    const next: Record<string, PortalScraper> = {};
    for (const p of activos) {
      next[p.slug] = buildGenericScraper(p);
    }
    scrapersCustomCache = next;
    scrapersCustomLastFetch = Date.now();
    if (activos.length > 0) {
      logger.info(`[portales/orchestrator] ${activos.length} portales custom cargados: ${activos.map((p) => p.slug).join(', ')}`);
    }
  } catch (err) {
    logger.warn(`[portales/orchestrator] no se pudo refrescar portales custom: ${err instanceof Error ? err.message : err}`);
  }
}

async function scrapersActuales(): Promise<Record<string, PortalScraper>> {
  const stale = Date.now() - scrapersCustomLastFetch > CUSTOM_REFRESH_MS;
  if (stale) await refrescarScrapersCustom();
  return { ...SCRAPERS_HARDCODED, ...scrapersCustomCache };
}

/**
 * Registry legacy usado por endpoints que necesitan la lista (ej.
 * /api/scrapers/status muestra los 6 hardcoded como los "canonical"). Los
 * custom se listan aparte via listarPortalesCustom.
 */
export const SCRAPERS: Record<string, PortalScraper> = SCRAPERS_HARDCODED;

/** Slugs de portales hardcoded — usado por config-admin.ts. */
export const PORTALES_HARDCODED_KEYS = Object.keys(SCRAPERS_HARDCODED);

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
  // Sprint portales-custom (2026-07-06): resolver desde hardcoded + custom en DB.
  const all = await scrapersActuales();
  const scraper = all[portal];
  if (!scraper) {
    throw new Error(`Portal desconocido: ${portal}. Válidos: ${Object.keys(all).join(', ')}`);
  }

  const t0 = Date.now();
  const notas = await scraper.scrape();

  // Si es custom y trajo >=1 nota → registrar ultimoScrapeOk para healthcheck.
  if (notas.length > 0 && !SCRAPERS_HARDCODED[portal]) {
    await marcarUltimoScrapeOk(portal);
  }
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
  // Sprint portales-custom (2026-07-06): incluir hardcoded + custom activos.
  const all = await scrapersActuales();
  logger.info(`[portales] iniciando corrida de ${Object.keys(all).length} portales en paralelo`);
  const promises = Object.keys(all).map((p) =>
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
