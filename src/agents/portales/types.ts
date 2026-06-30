/**
 * Sprint scrapers-portales (2026-06-30) — Tipos del módulo de scraping.
 *
 * Cada scraper concreto implementa `PortalScraper`. El orchestrator
 * (src/agents/portales/index.ts) los corre via cron y manda el output al
 * pre-filtro + pipeline existente.
 */

export interface NotaScrapeada {
  /** Nombre canónico del portal: 'clarin' | 'cronica' | 'infobae' | ... */
  portal: string;
  /** URL canónica de la nota. */
  url: string;
  /** Titular tal como aparece en la portada del portal. */
  titulo: string;
  /** Bajada/copete o primer párrafo, si lo pudimos extraer. */
  resumen: string;
  /** Fecha de publicación si está parseable. Null si no la extraemos. */
  publishedAt: Date | null;
}

export interface PortalScraper {
  /** Nombre canónico (matchea `portalOrigen` en DB). */
  nombre: string;
  /** URL base de la sección scrapeada (para audit/healthcheck). */
  url: string;
  /**
   * Ejecuta una corrida del scraper. Retorna 0..N notas encontradas en la
   * portada. Si falla por error transient (network, 5xx, HTML cambiado),
   * loguea y retorna [].
   */
  scrape(): Promise<NotaScrapeada[]>;
}
