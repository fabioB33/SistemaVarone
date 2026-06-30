/**
 * Tests del parser de errores del publisher (Sprint flujo-errores-editables
 * 2026-06-30).
 */

import { describe, expect, it } from 'vitest';
import { parseFramerError } from '../../src/services/framer-error-parser';

describe('parseFramerError', () => {
  it('CASO REAL #10: Cisterna en Tipo de Vehículo', () => {
    const r = parseFramerError('No pude seleccionar "Cisterna" en el dropdown "Tipo de Vehículo"');
    expect(r.fieldKey).toBe('tipoVehiculo');
    expect(r.fieldLabel).toBe('Tipo de Vehículo');
    expect(r.attemptedValue).toBe('Cisterna');
  });

  it('CASO REAL #7: Repuestos y Neumáticos en Carga Transportada', () => {
    const r = parseFramerError('No pude seleccionar "Repuestos y Neumáticos" en el dropdown "Carga Transportada"');
    expect(r.fieldKey).toBe('cargaTransportada');
    expect(r.fieldLabel).toBe('Carga Transportada');
    expect(r.attemptedValue).toBe('Repuestos y Neumáticos');
  });

  it('mapea cada label canonical a la key correcta', () => {
    const cases = [
      ['Provincia',                          'provincia'],
      ['Tipo de Incidente',                  'tipoIncidenteFramer'],
      ['Fuerza Interviniente',               'fuerzaInterviniente'],
      ['Tipo de Vehículo',                   'tipoVehiculo'],
      ['Carga Transportada',                 'cargaTransportada'],
      ['Modus Operandi',                     'modusOperandi'],
      ['¿Hubo violencia?',                   'huboViolencia'],
      ['Tipo de Vehículo Involucrado',       'tipoVehiculoInvolucrado'],
      ['Cantidad de Vehículos Involucrados', 'cantidadVehiculosInvolucrados'],
      ['Cantidad de Personas Involucradas',  'cantidadPersonasInvolucradas'],
    ] as const;
    for (const [label, expectedKey] of cases) {
      const r = parseFramerError(`No pude seleccionar "X" en el dropdown "${label}"`);
      expect(r.fieldKey).toBe(expectedKey);
    }
  });

  it('label desconocido → fieldKey null pero preserva el resto', () => {
    const r = parseFramerError('No pude seleccionar "Foo" en el dropdown "Algo Inexistente"');
    expect(r.fieldKey).toBe(null);
    expect(r.fieldLabel).toBe('Algo Inexistente');
    expect(r.attemptedValue).toBe('Foo');
  });

  it('error sin shape canonical → todo null pero preserva raw', () => {
    const r = parseFramerError('Error inesperado en Playwright: timeout');
    expect(r.fieldKey).toBe(null);
    expect(r.fieldLabel).toBe(null);
    expect(r.attemptedValue).toBe(null);
    expect(r.raw).toBe('Error inesperado en Playwright: timeout');
  });

  it('null / undefined input', () => {
    expect(parseFramerError(null).raw).toBe('');
    expect(parseFramerError(undefined).raw).toBe('');
    expect(parseFramerError('').fieldKey).toBe(null);
  });
});
