/**
 * Extrae la imagen Open Graph de una URL de noticia.
 *
 * Estrategia: descarga el HTML, parsea las primeras kilobytes buscando
 * <meta property="og:image" content="..."> o twitter:image como fallback.
 * Sin librerías externas para evitar peso.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 200 * 1024; // 200 KB es más que suficiente para el <head>

export async function extractOgImage(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SistemaVaronePublisher/1.0; +https://www.varone.com.ar)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    }).finally(() => clearTimeout(timer));

    if (!res.ok || !res.body) return null;

    // Leer solo los primeros bytes para no descargar páginas enteras
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try {
      await reader.cancel();
    } catch {
      // ignorar
    }

    const html = new TextDecoder('utf-8', { fatal: false }).decode(
      concat(chunks),
    );

    return findMetaImage(html);
  } catch {
    return null;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Decodifica las HTML entities mas comunes en URLs.
 * Necesario porque algunos sitios (como La Nacion) escriben las URLs de
 * og:image con `&amp;` en lugar de `&`, y Framer rechaza esa URL al intentar
 * descargarla con un 400.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function findMetaImage(html: string): string | null {
  // Buscar og:image (property o name) y twitter:image como fallback.
  // Tolerante al orden de atributos y comillas simples/dobles.
  const candidates = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];

  for (const re of candidates) {
    const m = html.match(re);
    if (m && m[1]) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}
