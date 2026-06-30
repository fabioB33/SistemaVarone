/**
 * Sprint scrapers-portales (2026-06-30) — Pre-filtro de keywords.
 *
 * Antes de gastar quota de Gemini con cada nota scrapeada, evaluamos si el
 * texto MATCHA keywords del nicho (whitelist) y si NO matchea keywords de
 * descarte (blacklist).
 *
 * Decisión:
 *   matchea blacklist → DESCARTAR (razon='blacklist')
 *   no matchea ninguna whitelist → DESCARTAR (razon='sin-keywords')
 *   matchea whitelist sin blacklist → PASA al pipeline IA
 *
 * Ejemplo real (regla #7 EMPIRICAL-FIRST): la nota de Tartagal del 2026-06-30
 * sobre "asalto en RN 34" que en realidad era un operativo narco con 70 kg de
 * cocaína → contiene whitelist "ruta", "Renault", "dispararon" PERO también
 * blacklist "cocaína", "doble fondo" → descartar antes de IA.
 *
 * Trade-offs (regla #1):
 *  - Whitelist agresiva pierde nichos raros pero ahorra mucha IA. Mejor falso
 *    negativo del prefiltro que falso positivo de la IA.
 *  - Blacklist con palabras inequívocamente del NO-nicho (narco, drogas,
 *    homicidios sin contexto vehicular). Si Varone reporta "robaron
 *    estupefacientes de un camión" → matchea blacklist y descartamos. Riesgo
 *    real pero aceptable: ese caso es raro y se puede sumar al prompt IA después.
 *  - Listas configurables vía env var (regla #9 NO-HARDCODED) si Varone quiere
 *    tunear sin redeploy.
 */

import { ENV } from '../config/env';

/**
 * Keywords del nicho. Si el texto matchea AL MENOS UNA, pasa al pipeline.
 * Ordenadas por relevancia para reportar matches útiles a la auditoría.
 */
export const WHITELIST_DEFAULT = [
  // Vehículos del nicho (lo más fuerte)
  'camión', 'camion', 'camioneros', 'camioneras', 'camionero',
  'tráiler', 'trailer', 'acoplado', 'semirremolque', 'semi remolque',
  'cisterna', 'volcado',
  'transportista', 'transporte de carga',
  'chofer de camión', 'chofer del camión',

  // Hechos canónicos del nicho
  'piratas del asfalto', 'pirata del asfalto', 'piratería',
  'piratería del asfalto', 'pirateria del asfalto',
  'robo de carga', 'robo de mercadería', 'robo de mercaderia',
  'asalto a camión', 'asalto al camión', 'asalto camión',
  'asalto camionero', 'asaltaron camión', 'asaltaron al camión',
  'bloqueo de ruta', 'bloquearon la ruta', 'cortaron la ruta',
  'corte de ruta', 'cortes de ruta',

  // Cargas típicas (asaltadas)
  'cargamento', 'carga robada', 'carga sustraída', 'carga sustraida',
  'mercadería robada', 'mercaderia robada',

  // Modus operandi típicos
  'salidera', 'salideras',
];

/**
 * Keywords que descartan AUNQUE matcheen whitelist. Inequívocas de OTRO nicho.
 *
 * Reglas:
 *  - Narco: cualquier mención sin ambigüedad. Si dice "narcotráfico" o
 *    "cargamento de droga" NO es piratería aunque hablen de "asalto" o "ruta".
 *  - Doble fondo / mexicaneada: vocabulario claramente narco.
 *  - Personas como objeto: secuestros, homicidios sin contexto vehicular.
 *  - Política: contrabando, aduana, electrónica decomisada.
 *  - Animales: el "asalto al cargamento" puede ser ganado, no carga comercial.
 *  - Deportes / eventos: evita "asalto en zona del autódromo" falsos positivos.
 */
export const BLACKLIST_DEFAULT = [
  // Narcotráfico inequívoco
  'narcotráfico', 'narcotrafico', 'narco', 'narcos',
  'cocaína', 'cocaina', 'marihuana', 'marihuanas', 'paco', 'estupefaciente',
  'estupefacientes', 'droga', 'drogas', 'cargamento de droga',
  'cargamento de cocaína', 'cargamento de cocaina',
  'cargamento narco', 'paquetes de cocaína', 'paquetes de cocaina',
  'doble fondo', 'mexicaneada', 'mexicaneadas',

  // Personas como objeto
  'secuestro de personas', 'secuestraron a',
  'homicidio', 'homicidios', 'femicidio', 'femicidios',

  // Política / contrabando "blanco"
  'contrabando', 'aduana decomis', 'aduana incautó', 'aduana incauto',

  // Animales
  'cabezas de ganado', 'ganado vacuno', 'cuatreros',

  // Deportes/eventos
  'autódromo', 'autodromo', 'campeonato',
];

export type RazonDescarte = 'blacklist' | 'sin-keywords';

export interface ResultadoPrefiltro {
  pasa: boolean;
  razon: RazonDescarte | 'ok';
  matchedKeywords: string[]; // las keywords que matcheron (whitelist o blacklist)
}

/**
 * Normaliza para matching: lowercase + sin tildes + sin signos.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar tildes
    .replace(/[^\w\s]/g, ' ')         // signos → espacios (preserva separación)
    .replace(/\s+/g, ' ')
    .trim();
}

function getWhitelist(): string[] {
  if (ENV.PREFILTRO_WHITELIST_EXTRA) {
    const extra = ENV.PREFILTRO_WHITELIST_EXTRA.split(',').map((s) => s.trim()).filter(Boolean);
    return [...WHITELIST_DEFAULT, ...extra];
  }
  return WHITELIST_DEFAULT;
}

function getBlacklist(): string[] {
  if (ENV.PREFILTRO_BLACKLIST_EXTRA) {
    const extra = ENV.PREFILTRO_BLACKLIST_EXTRA.split(',').map((s) => s.trim()).filter(Boolean);
    return [...BLACKLIST_DEFAULT, ...extra];
  }
  return BLACKLIST_DEFAULT;
}

/**
 * Pre-filtra un texto (título + resumen del portal).
 *
 * @param texto Contenido completo a evaluar (titulo + ' ' + resumen).
 * @param titulo Opcional, solo para logs de auditoría más limpios.
 */
export function preFiltrar(texto: string, _titulo?: string): ResultadoPrefiltro {
  const norm = normalizar(texto);
  const whitelist = getWhitelist();
  const blacklist = getBlacklist();

  // Las keywords pueden tener espacios — normalizamos también.
  const whitelistNorm = whitelist.map(normalizar);
  const blacklistNorm = blacklist.map(normalizar);

  // 1. Blacklist: si matchea cualquiera, descarte inmediato.
  const matchedBlack = blacklistNorm
    .map((k, i) => (norm.includes(k) ? whitelist[i] || blacklist[i] : null))
    .filter((x): x is string => x !== null);

  // Re-mapeamos con el blacklist original (no whitelist)
  const matchedBlackReal = blacklist.filter((k) => norm.includes(normalizar(k)));
  if (matchedBlackReal.length > 0) {
    return {
      pasa: false,
      razon: 'blacklist',
      matchedKeywords: matchedBlackReal,
    };
  }

  // 2. Whitelist: si matchea al menos una, pasa.
  const matchedWhite = whitelist.filter((k) => norm.includes(normalizar(k)));
  if (matchedWhite.length > 0) {
    return {
      pasa: true,
      razon: 'ok',
      matchedKeywords: matchedWhite,
    };
  }

  // 3. Sin matches en ningún lado: descarte por irrelevancia.
  void matchedBlack; // no-op, evita unused-var warning si TS strict.
  return {
    pasa: false,
    razon: 'sin-keywords',
    matchedKeywords: [],
  };
}

/** Exportado para tests. */
export const _internals = { normalizar, getWhitelist, getBlacklist };
