/**
 * Sprint flujo-errores-editables (2026-06-30) — Parser del error del publisher.
 *
 * El publisher Playwright (framer-publisher/src/form-filler.ts:180) lanza
 * errores con shape canonical:
 *
 *   `No pude seleccionar "${valor}" en el dropdown "${campo}"`
 *
 * Este parser extrae el campo + valor culpable + lo mapea a la key canonical
 * del schema (`tipoVehiculo`, `cargaTransportada`, etc.) para que el frontend
 * pueda resaltar el dropdown roto + sugerir corrección.
 */

/** Mapeo del label visible del form Framer a la key canonical del schema. */
const FORM_LABEL_TO_FIELD_KEY: Record<string, string> = {
  'Provincia':                          'provincia',
  'Tipo de Incidente':                  'tipoIncidenteFramer',
  'Fuerza Interviniente':               'fuerzaInterviniente',
  'Tipo de Vehículo':                   'tipoVehiculo',
  'Carga Transportada':                 'cargaTransportada',
  'Modus Operandi':                     'modusOperandi',
  '¿Hubo violencia?':                   'huboViolencia',
  'Tipo de Vehículo Involucrado':       'tipoVehiculoInvolucrado',
  'Cantidad de Vehículos Involucrados': 'cantidadVehiculosInvolucrados',
  'Cantidad de Personas Involucradas':  'cantidadPersonasInvolucradas',
};

export interface ParsedFramerError {
  /** El mensaje original tal cual lo lanzó el publisher. */
  raw: string;
  /** Key canonical del campo en el schema (ej. 'tipoVehiculo'). Null si no se reconoce. */
  fieldKey: string | null;
  /** Label visible que tenía el dropdown en el form (ej. 'Tipo de Vehículo'). Null si parser no matchea. */
  fieldLabel: string | null;
  /** Valor que el publisher intentó setear pero no encontró (ej. 'Cisterna'). Null si parser no matchea. */
  attemptedValue: string | null;
}

/**
 * Parsea un mensaje de error del publisher. Retorna estructura canonical para
 * que el UI sepa qué resaltar.
 *
 * Si el mensaje no coincide con el shape esperado, retorna todos los campos
 * null pero preserva el raw para mostrar al usuario igual.
 */
export function parseFramerError(rawError: string | null | undefined): ParsedFramerError {
  const raw = (rawError || '').trim();

  // Pattern: `No pude seleccionar "X" en el dropdown "Y"`
  const match = raw.match(/No pude seleccionar "([^"]+)" en el dropdown "([^"]+)"/);
  if (!match) {
    return { raw, fieldKey: null, fieldLabel: null, attemptedValue: null };
  }

  const attemptedValue = match[1];
  const fieldLabel = match[2];
  const fieldKey = FORM_LABEL_TO_FIELD_KEY[fieldLabel] ?? null;

  return { raw, fieldKey, fieldLabel, attemptedValue };
}

/** Exportado para tests. */
export const _internals = { FORM_LABEL_TO_FIELD_KEY };
