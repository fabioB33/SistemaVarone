/**
 * Sprint pivot-framer-form (2026-06-26) — Helper de fuzzy-match enum.
 *
 * Cuando la IA responde con un valor cercano pero no idéntico al enum
 * canonical (ej. "Bs As" vs "Buenos Aires", "Federal" vs "Policía Federal"),
 * este helper intenta resolverlo automáticamente.
 *
 * Estrategia:
 *  1. Match exacto (case-insensitive, sin tildes).
 *  2. Match contains (input ⊂ enum o enum ⊂ input, normalizado).
 *  3. Match por palabras clave del enum.
 *  4. Si nada matchea, retorna null + el caller marca el campo como faltante.
 *
 * NUNCA "adivina" ni elige "Otro" automáticamente. Si no hay match claro,
 * retorna null y el reporte queda pendiente_revision para que Varone elija.
 * Eso preserva la integridad editorial (regla #1 SIN ATAJOS).
 */

import {
  PROVINCIAS_AR,
  TIPOS_INCIDENTE_FRAMER,
  FUERZAS_INTERVINIENTES,
  TIPOS_VEHICULO,
  CARGAS_TRANSPORTADAS,
  MODUS_OPERANDI,
  HUBO_VIOLENCIA,
  TIPOS_VEHICULO_INVOLUCRADO,
  CANTIDADES_VEHICULOS,
  CANTIDADES_PERSONAS,
} from '../config/enums-framer';

/**
 * Normaliza un string: lowercase + sin tildes + sin puntuación + colapsa espacios.
 */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?¡¿"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Intenta encontrar el enum canonical que mejor matchea el input.
 * Retorna null si no hay match razonable.
 */
export function matchEnum(input: string | null | undefined, options: readonly string[]): string | null {
  if (!input) return null;
  const inputNorm = normalizar(input);
  if (!inputNorm) return null;

  // 1. Match exacto (post-normalización)
  for (const opt of options) {
    if (normalizar(opt) === inputNorm) return opt;
  }

  // 2. Match por substring: input incluido en opt, o viceversa.
  // Threshold: substring debe tener >=4 chars para evitar matches espurios.
  if (inputNorm.length >= 4) {
    for (const opt of options) {
      const optNorm = normalizar(opt);
      if (optNorm.includes(inputNorm) || inputNorm.includes(optNorm)) {
        return opt;
      }
    }
  }

  // 3. Match por palabra clave: cada palabra distintiva del enum tiene que
  // aparecer en el input. Ej: "Buenos Aires" → input tiene "buenos" Y "aires".
  for (const opt of options) {
    const palabrasOpt = normalizar(opt).split(' ').filter((w) => w.length >= 4);
    if (palabrasOpt.length === 0) continue;
    const palabrasInput = new Set(inputNorm.split(' '));
    const matched = palabrasOpt.filter((w) => palabrasInput.has(w));
    // Considera match si TODAS las palabras clave aparecen en el input.
    if (matched.length === palabrasOpt.length) return opt;
  }

  return null;
}

// ============================================================
// Helpers específicos por campo (typed wrappers)
// ============================================================

export const matchProvincia = (s: string | null | undefined) => matchEnum(s, PROVINCIAS_AR);
export const matchTipoIncidente = (s: string | null | undefined) => matchEnum(s, TIPOS_INCIDENTE_FRAMER);
export const matchFuerzaInterviniente = (s: string | null | undefined) => matchEnum(s, FUERZAS_INTERVINIENTES);
export const matchTipoVehiculo = (s: string | null | undefined) => matchEnum(s, TIPOS_VEHICULO);
export const matchCargaTransportada = (s: string | null | undefined) => matchEnum(s, CARGAS_TRANSPORTADAS);
export const matchModusOperandi = (s: string | null | undefined) => matchEnum(s, MODUS_OPERANDI);
export const matchHuboViolencia = (s: string | null | undefined) => matchEnum(s, HUBO_VIOLENCIA);
export const matchTipoVehiculoInvolucrado = (s: string | null | undefined) =>
  matchEnum(s, TIPOS_VEHICULO_INVOLUCRADO);
export const matchCantidadVehiculos = (s: string | null | undefined) => matchEnum(s, CANTIDADES_VEHICULOS);
export const matchCantidadPersonas = (s: string | null | undefined) => matchEnum(s, CANTIDADES_PERSONAS);

// ============================================================
// Resolver completo de los 10 campos
// ============================================================

export interface CamposFramerResueltos {
  provincia: string | null;
  tipoIncidenteFramer: string | null;
  fuerzaInterviniente: string | null;
  tipoVehiculo: string | null;
  cargaTransportada: string | null;
  modusOperandi: string | null;
  huboViolencia: string | null;
  tipoVehiculoInvolucrado: string | null;
  cantidadVehiculosInvolucrados: string | null;
  cantidadPersonasInvolucradas: string | null;
  /**
   * Lista de campos donde el matcher NO logró resolver. Si tiene
   * entries → reporte queda en `pendiente_revision`.
   */
  camposFaltantes: string[];
}

interface CamposFramerInput {
  provincia?: string | null;
  tipoIncidenteFramer?: string | null;
  fuerzaInterviniente?: string | null;
  tipoVehiculo?: string | null;
  cargaTransportada?: string | null;
  modusOperandi?: string | null;
  huboViolencia?: string | null;
  tipoVehiculoInvolucrado?: string | null;
  cantidadVehiculosInvolucrados?: string | null;
  cantidadPersonasInvolucradas?: string | null;
}

/**
 * Aplica el matcher a los 10 campos a la vez. Devuelve los valores
 * resueltos + la lista de campos que quedaron faltantes.
 */
export function resolverCamposFramer(input: CamposFramerInput): CamposFramerResueltos {
  const out = {
    provincia: matchProvincia(input.provincia),
    tipoIncidenteFramer: matchTipoIncidente(input.tipoIncidenteFramer),
    fuerzaInterviniente: matchFuerzaInterviniente(input.fuerzaInterviniente),
    tipoVehiculo: matchTipoVehiculo(input.tipoVehiculo),
    cargaTransportada: matchCargaTransportada(input.cargaTransportada),
    modusOperandi: matchModusOperandi(input.modusOperandi),
    huboViolencia: matchHuboViolencia(input.huboViolencia),
    tipoVehiculoInvolucrado: matchTipoVehiculoInvolucrado(input.tipoVehiculoInvolucrado),
    cantidadVehiculosInvolucrados: matchCantidadVehiculos(input.cantidadVehiculosInvolucrados),
    cantidadPersonasInvolucradas: matchCantidadPersonas(input.cantidadPersonasInvolucradas),
  };

  const camposFaltantes: string[] = [];
  if (!out.provincia) camposFaltantes.push('provincia');
  if (!out.tipoIncidenteFramer) camposFaltantes.push('tipoIncidenteFramer');
  if (!out.fuerzaInterviniente) camposFaltantes.push('fuerzaInterviniente');
  if (!out.tipoVehiculo) camposFaltantes.push('tipoVehiculo');
  if (!out.cargaTransportada) camposFaltantes.push('cargaTransportada');
  if (!out.modusOperandi) camposFaltantes.push('modusOperandi');
  if (!out.huboViolencia) camposFaltantes.push('huboViolencia');
  if (!out.tipoVehiculoInvolucrado) camposFaltantes.push('tipoVehiculoInvolucrado');
  if (!out.cantidadVehiculosInvolucrados) camposFaltantes.push('cantidadVehiculosInvolucrados');
  if (!out.cantidadPersonasInvolucradas) camposFaltantes.push('cantidadPersonasInvolucradas');

  return { ...out, camposFaltantes };
}
