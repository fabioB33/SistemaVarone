import { chromium, Browser } from 'playwright';
import cron from 'node-cron';
import { PORTALES } from '../config/portales';
import { ENV } from '../config/env';
import { NoticiaCruda, PortalConfig } from '../types';
import { procesarTexto } from '../services/pipeline';

let browser: Browser | null = null;

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
  console.log('[Scraper] Iniciando ronda de scraping...');

  for (const portal of PORTALES) {
    console.log(`[Scraper] Scrapeando: ${portal.nombre}`);

    const noticias = await scrapearPortal(portal);
    console.log(`[Scraper] ${noticias.length} noticias encontradas en ${portal.nombre}`);

    for (const noticia of noticias) {
      const enriquecida = await enriquecerNoticia(noticia, portal);
      const textoCompleto = `${enriquecida.titulo}\n${enriquecida.contenido}`;

      await procesarTexto(textoCompleto, 'scraping', enriquecida.url);
    }
  }

  console.log('[Scraper] Ronda de scraping finalizada.');
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
