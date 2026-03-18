import { chromium } from 'playwright';
import { procesarTexto } from '../services/pipeline';

const BUSQUEDAS = [
  { url: 'https://www.infobae.com/tag/piratas-del-asfalto/', nombre: 'Infobae - Piratas' },
  { url: 'https://www.clarin.com/tema/piratas-del-asfalto.html', nombre: 'Clarín - Piratas' },
  { url: 'https://www.lanacion.com.ar/buscar/piratas+del+asfalto/', nombre: 'La Nación - Piratas' },
  { url: 'https://tn.com.ar/buscar/?q=piratas+del+asfalto', nombre: 'TN - Piratas' },
  { url: 'https://www.cronica.com.ar/buscador?query=robo+camion+carga', nombre: 'Crónica - Robo carga' },
  { url: 'https://www.infobae.com/tag/robo-de-camiones/', nombre: 'Infobae - Robo camiones' },
  { url: 'https://www.clarin.com/tema/robo-de-camiones.html', nombre: 'Clarín - Robo camiones' },
];

async function buscarYProcesar() {
  console.log('=== Buscando noticias de piratería de camiones ===\n');

  const browser = await chromium.launch({ headless: true });
  let totalProcesadas = 0;

  for (const busqueda of BUSQUEDAS) {
    console.log(`\n▸ ${busqueda.nombre}: ${busqueda.url}`);

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(busqueda.url, { timeout: 15000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // Extraer links de artículos
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors
          .map(a => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim() || '' }))
          .filter(l =>
            l.href.includes('/202') &&
            l.text.length > 30 &&
            !l.href.includes('/autor/') &&
            !l.href.includes('/tag/') &&
            !l.href.includes('/tema/')
          )
          .slice(0, 5);
      });

      console.log(`  ${links.length} artículos encontrados`);

      for (const link of links) {
        try {
          console.log(`  → ${link.text.substring(0, 70)}...`);

          const articlePage = await context.newPage();
          await articlePage.goto(link.href, { timeout: 15000, waitUntil: 'domcontentloaded' });
          await articlePage.waitForTimeout(1000);

          const contenido = await articlePage.evaluate(() => {
            const paragraphs = Array.from(document.querySelectorAll('article p, .article-body p, .body-nota p, [data-component="Paragraph"] p, .story-body p, .entry-content p'));
            if (paragraphs.length > 0) {
              return paragraphs.map(p => p.textContent?.trim()).filter(Boolean).join('\n');
            }
            // Fallback: todos los <p> del main
            const allP = Array.from(document.querySelectorAll('main p, #content p'));
            return allP.map(p => p.textContent?.trim()).filter(Boolean).slice(0, 15).join('\n');
          });

          if (contenido && contenido.length > 100) {
            const textoCompleto = link.text + '\n\n' + contenido;
            await procesarTexto(textoCompleto, 'scraping', link.href);
            totalProcesadas++;
          }

          await articlePage.close();
        } catch (e) {
          console.log(`  ✗ Error en artículo: ${(e as Error).message?.substring(0, 50)}`);
        }
      }

      await context.close();
    } catch (e) {
      console.log(`  ✗ Error en portal: ${(e as Error).message?.substring(0, 60)}`);
    }
  }

  await browser.close();

  console.log(`\n=== Fin. ${totalProcesadas} artículos procesados por el pipeline ===`);
}

buscarYProcesar().catch(console.error);
