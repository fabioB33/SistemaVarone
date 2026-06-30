/**
 * Sprint scrapers-portales (2026-06-30) — Helpers de parseo HTML.
 *
 * Usamos `linkedom` (no cheerio) porque:
 *  - Es 3x más liviano (no jQuery API)
 *  - Sintaxis DOM nativa: querySelector / querySelectorAll
 *  - Mucho más fácil de testear con HTML fixtures (los selectores son
 *    los mismos que `document.querySelector` en el browser)
 *  - Ya está disponible en monorepo Pampa Labs
 *
 * Si linkedom no estuviera instalado, el fallback a regex es viable para
 * HTMLs simples — pero el módulo prefiere DOM real.
 */

import { parseHTML } from 'linkedom';

export interface ParsedDoc {
  doc: Document;
  /** Helper: querySelector que retorna texto limpio o '' */
  text: (sel: string, root?: Element | Document) => string;
  /** Helper: querySelector que retorna atributo o '' */
  attr: (sel: string, attribute: string, root?: Element | Document) => string;
  /** Helper: querySelectorAll que retorna array (no NodeList) */
  all: (sel: string, root?: Element | Document) => Element[];
}

export function parseDocument(html: string): ParsedDoc {
  const { document } = parseHTML(html);

  const text = (sel: string, root: Element | Document = document): string => {
    const el = root.querySelector(sel);
    return el?.textContent?.trim() || '';
  };

  const attr = (sel: string, attribute: string, root: Element | Document = document): string => {
    const el = root.querySelector(sel);
    return el?.getAttribute(attribute) || '';
  };

  const all = (sel: string, root: Element | Document = document): Element[] => {
    return Array.from(root.querySelectorAll(sel));
  };

  return { doc: document, text, attr, all };
}

/**
 * Resuelve URL relativa a absoluta. Útil para hrefs que vienen como "/policia/..".
 */
export function absoluteUrl(href: string, base: string): string {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/**
 * Normaliza un texto para resumen: quita whitespace excesivo + corta a N chars.
 */
export function limpiarResumen(texto: string, maxChars = 600): string {
  return texto
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Parsea fechas en formatos típicos de portales argentinos.
 * Heurística: prueba ISO primero, después formatos locales.
 *
 * Casos cubiertos:
 *  - "2026-06-30T14:30:00Z" → ISO
 *  - "30 de junio de 2026" → DD MMM YYYY
 *  - "30/06/2026"          → DD/MM/YYYY
 *  - "Hace 2 horas"        → resta a now() (Crónica usa esto)
 *
 * Si no logra parsear, retorna null (NO lanza, para no romper el scraping).
 */
export function parseFecha(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = s.trim();

  // Intento ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // DD/MM/YYYY o DD-MM-YYYY
  const ddmm = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (ddmm) {
    const d = new Date(Number(ddmm[3]), Number(ddmm[2]) - 1, Number(ddmm[1]));
    if (!isNaN(d.getTime())) return d;
  }

  // "Hace X horas" / "Hace X minutos"
  const hace = trimmed.toLowerCase().match(/hace\s+(\d+)\s+(hora|minuto|día|dia)/);
  if (hace) {
    const n = Number(hace[1]);
    const unidad = hace[2];
    const factor =
      unidad === 'hora' ? 60 * 60 * 1000
      : unidad === 'minuto' ? 60 * 1000
      : 24 * 60 * 60 * 1000;
    return new Date(Date.now() - n * factor);
  }

  // DD de MMMM de YYYY
  const meses: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };
  const fechaTexto = trimmed.toLowerCase().match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (fechaTexto) {
    const mes = meses[fechaTexto[2]];
    if (mes !== undefined) {
      const d = new Date(Number(fechaTexto[3]), mes, Number(fechaTexto[1]));
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
}
