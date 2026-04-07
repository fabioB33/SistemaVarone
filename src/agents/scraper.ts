import { chromium, Browser } from 'playwright';
import cron from 'node-cron';
import { PORTALES } from '../config/portales';
import { ENV } from '../config/env';
import { NoticiaCruda, PortalConfig } from '../types';
import { procesarTexto } from '../services/pipeline';
import { setScrapingStatus } from '../dashboard/server';

let browser: Browser | null = null;
let scraperCorriendo = false;

// Circuit breaker por portal: después de 3 fallos consecutivos, saltar N ciclos
const FALLOS_PARA_ABRIR = 3;
const CICLOS_COOLDOWN = 5;
const portalFallos = new Map<string, number>();    // portal → fallos consecutivos
const portalCooldown = new Map<string, number>();  // portal → ciclos restantes de pausa

function portalBloqueado(nombre: string): boolean {
  const cooldown = portalCooldown.get(nombre) ?? 0;
  if (cooldown > 0) {
    portalCooldown.set(nombre, cooldown - 1);
    console.warn(`[Scraper] Portal "${nombre}" en cooldown (${cooldown} ciclos restantes), saltando.`);
    return true;
  }
  return false;
}

function registrarFalloPortal(nombre: string): void {
  const fallos = (portalFallos.get(nombre) ?? 0) + 1;
  portalFallos.set(nombre, fallos);
  if (fallos >= FALLOS_PARA_ABRIR) {
    portalCooldown.set(nombre, CICLOS_COOLDOWN);
    portalFallos.set(nombre, 0);
    console.error(`[Scraper] Portal "${nombre}" bloqueado por ${CICLOS_COOLDOWN} ciclos tras ${fallos} fallos consecutivos.`);
  }
}

function registrarExitoPortal(nombre: string): void {
  portalFallos.set(nombre, 0);
}

function resolverUrl(href: string, baseUrl?: string): string {
  if (href.startsWith('http')) return href;
  if (baseUrl) return `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
  return href;
}

async function scrapearPortal(portal: PortalConfig): Promise<NoticiaCruda[]> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }

  const page = await browser.newPage();
  const noticias: NoticiaCruda[] = [];

  try {
    await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Esperar a que el contenido dinámico cargue
    await page.waitForSelector(portal.selectores.listado, { timeout: 10000 }).catch(() => {});

    const articulos = await page.$$(portal.selectores.listado);

    for (const articulo of articulos.slice(0, 10)) {
      const titulo = await articulo.$eval(
        portal.selectores.titulo,
        (el) => el.textContent?.trim() || ''
      ).catch(() => {
        // Si el selector de título falla, intentar el texto del propio elemento
        return articulo.textContent().then(t => t?.trim() || '');
      });

      let link = '';
      // Si el listado es un <a>, el link es el propio elemento
      const tagName = await articulo.evaluate(el => el.tagName.toLowerCase());
      if (tagName === 'a') {
        link = await articulo.getAttribute('href') || '';
      } else {
        link = await articulo.$eval(
          portal.selectores.link,
          (el) => el.getAttribute('href') || ''
        ).catch(() => '');
      }

      const fecha = portal.selectores.fecha
        ? await articulo.$eval(
            portal.selectores.fecha,
            (el) => el.textContent?.trim() || ''
          ).catch(() => undefined)
        : undefined;

      if (titulo && link) {
        noticias.push({
          titulo,
          contenido: '',
          url: resolverUrl(link, portal.baseUrl),
          portal: portal.nombre,
          fechaPublicacion: fecha,
        });
      }
    }
  } catch (error) {
    console.error(`[Scraper] Error en ${portal.nombre}:`, error);
  } finally {
    await page.close();
  }

  return noticias;
}

async function enriquecerNoticia(noticia: NoticiaCruda, portal: PortalConfig): Promise<NoticiaCruda> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }

  const page = await browser.newPage();

  try {
    await page.goto(noticia.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const parrafos = await page.$$eval(
      portal.selectores.contenido,
      (els) => els.map((el) => el.textContent?.trim() || '').filter(Boolean)
    );

    noticia.contenido = parrafos.join('\n');
  } catch (error) {
    console.error(`[Scraper] Error enriqueciendo "${noticia.titulo}":`, error);
  } finally {
    await page.close();
  }

  return noticia;
}

async function ejecutarScraping(): Promise<void> {
  if (scraperCorriendo) {
    console.warn('[Scraper] Ya hay un ciclo en ejecución, saltando.');
    return;
  }

  scraperCorriendo = true;
  setScrapingStatus('running');
  console.log('[Scraper] Iniciando ronda de scraping...');

  try {
    for (const portal of PORTALES) {
      if (portalBloqueado(portal.nombre)) continue;

      console.log(`[Scraper] Scrapeando: ${portal.nombre}`);

      try {
        const noticias = await scrapearPortal(portal);
        console.log(`[Scraper] ${noticias.length} noticias encontradas en ${portal.nombre}`);
        registrarExitoPortal(portal.nombre);

        for (const noticia of noticias) {
          const enriquecida = await enriquecerNoticia(noticia, portal);
          const textoCompleto = `${enriquecida.titulo}\n${enriquecida.contenido}`;
          await procesarTexto(textoCompleto, 'scraping', enriquecida.url, portal.nombre);
        }
      } catch (errorPortal) {
        console.error(`[Scraper] Fallo en portal "${portal.nombre}":`, errorPortal);
        registrarFalloPortal(portal.nombre);
      }
    }

    console.log('[Scraper] Ronda de scraping finalizada.');
  } catch (error) {
    console.error('[Scraper] Error inesperado en ciclo:', error);
  } finally {
    // Siempre cerrar browser y liberar el flag, incluso si hubo error
    if (browser) {
      await browser.close();
      browser = null;
    }
    scraperCorriendo = false;
    setScrapingStatus('idle');
  }
}

export function forzarScraping(): void {
  ejecutarScraping().catch(err => console.error('[Scraper] Error en scraping manual:', err));
}

/** Devuelve el estado del circuit breaker por portal para mostrarlo en el dashboard. */
export function getCircuitBreakerStatus(): Array<{ portal: string; fallos: number; cooldownRestante: number }> {
  return Array.from(new Set([...portalFallos.keys(), ...portalCooldown.keys()])).map(nombre => ({
    portal: nombre,
    fallos: portalFallos.get(nombre) ?? 0,
    cooldownRestante: portalCooldown.get(nombre) ?? 0,
  }));
}

export function iniciarScraper(): void {
  const minutos = ENV.SCRAPING_INTERVAL_MINUTES;
  const cronExpr = `*/${minutos} * * * *`;

  console.log(`[Scraper] Programado cada ${minutos} minutos (${cronExpr})`);

  // Ejecutar una vez al inicio
  ejecutarScraping().catch((err) => console.error('[Scraper] Error inicial:', err));

  // Programar ejecuciones periódicas
  cron.schedule(cronExpr, () => {
    ejecutarScraping().catch((err) => console.error('[Scraper] Error en cron:', err));
  });
}

export async function detenerScraper(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    console.log('[Scraper] Browser cerrado.');
  }
}
