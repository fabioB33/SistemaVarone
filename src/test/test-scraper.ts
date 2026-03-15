import { chromium } from 'playwright';
import { PORTALES } from '../config/portales';
import { PortalConfig } from '../types';

function resolverUrl(href: string, baseUrl?: string): string {
  if (href.startsWith('http')) return href;
  if (baseUrl) return `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
  return href;
}

async function testPortal(portal: PortalConfig): Promise<{ok: boolean; noticias: number; errores: string[]}> {
  const errores: string[] = [];
  let noticias = 0;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`\n  Cargando ${portal.url}...`);
    await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(portal.selectores.listado, { timeout: 10000 }).catch(() => {
      errores.push(`Selector de listado no encontrado: ${portal.selectores.listado}`);
    });

    const articulos = await page.$$(portal.selectores.listado);
    console.log(`  Artículos encontrados: ${articulos.length}`);

    if (articulos.length === 0) {
      errores.push('No se encontraron artículos');
    }

    // Testear los primeros 3 artículos
    for (const articulo of articulos.slice(0, 3)) {
      const titulo = await articulo.$eval(
        portal.selectores.titulo,
        (el) => el.textContent?.trim() || ''
      ).catch(() => '');

      let link = '';
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
          ).catch(() => '(sin fecha)')
        : '(sin selector)';

      if (titulo) {
        noticias++;
        const urlCompleta = resolverUrl(link, portal.baseUrl);
        console.log(`    ${noticias}. ${titulo.substring(0, 80)}...`);
        console.log(`       Link: ${urlCompleta.substring(0, 80)}`);
        if (fecha) console.log(`       Fecha: ${fecha}`);
      }
    }

    if (noticias === 0) {
      errores.push('No se pudo extraer ningún título');
    }

  } catch (error) {
    errores.push(`Error general: ${error}`);
  } finally {
    await browser.close();
  }

  return { ok: errores.length === 0, noticias, errores };
}

async function main() {
  console.log('==================================================');
  console.log('  Test de Scraping - Portales Reales');
  console.log('==================================================');

  let passed = 0;
  let failed = 0;

  for (const portal of PORTALES) {
    console.log(`\n▸ ${portal.nombre}`);
    const result = await testPortal(portal);

    if (result.ok) {
      console.log(`  \x1b[32m✓ OK\x1b[0m - ${result.noticias} noticias extraídas`);
      passed++;
    } else {
      console.log(`  \x1b[31m✗ FALLÓ\x1b[0m`);
      result.errores.forEach(e => console.log(`    → ${e}`));
      failed++;
    }
  }

  console.log('\n==================================================');
  console.log(`  Resultados: \x1b[32m${passed} OK\x1b[0m / \x1b[31m${failed} fallidos\x1b[0m`);
  console.log('==================================================');

  process.exit(failed > 0 ? 1 : 0);
}

main();
