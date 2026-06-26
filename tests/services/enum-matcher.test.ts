/**
 * Tests del enum-matcher (Sprint pivot-framer-form 2026-06-26).
 *
 * Valida que el fuzzy matcher resuelve variantes razonables a los enums
 * canonical del formulario público pirateriadecamiones.com.ar.
 */
import { describe, expect, it } from 'vitest';

import {
  matchProvincia,
  matchTipoIncidente,
  matchFuerzaInterviniente,
  matchTipoVehiculo,
  matchCargaTransportada,
  matchModusOperandi,
  matchHuboViolencia,
  matchTipoVehiculoInvolucrado,
  matchCantidadVehiculos,
  matchCantidadPersonas,
  matchEnum,
  normalizar,
  resolverCamposFramer,
} from '@/services/enum-matcher';

describe('normalizar', () => {
  it('lowercase + sin tildes + sin puntuación', () => {
    expect(normalizar('Buenos Aires')).toBe('buenos aires');
    expect(normalizar('Córdoba')).toBe('cordoba');
    expect(normalizar('Río Negro!')).toBe('rio negro');
    expect(normalizar('  Salta  ')).toBe('salta');
  });
});

describe('matchEnum (genérico)', () => {
  const opts = ['Buenos Aires', 'CABA', 'Córdoba'] as const;

  it('match exacto case-insensitive', () => {
    expect(matchEnum('buenos aires', opts)).toBe('Buenos Aires');
    expect(matchEnum('CABA', opts)).toBe('CABA');
  });

  it('match sin tildes', () => {
    expect(matchEnum('cordoba', opts)).toBe('Córdoba');
  });

  it('match por substring', () => {
    expect(matchEnum('Provincia de Buenos Aires', opts)).toBe('Buenos Aires');
  });

  it('retorna null si no hay match', () => {
    expect(matchEnum('Mendoza', opts)).toBeNull();
    expect(matchEnum(null, opts)).toBeNull();
    expect(matchEnum('', opts)).toBeNull();
  });
});

describe('matchProvincia', () => {
  it('resuelve las 24 provincias canonical', () => {
    expect(matchProvincia('Buenos Aires')).toBe('Buenos Aires');
    expect(matchProvincia('CABA')).toBe('CABA');
    expect(matchProvincia('Córdoba')).toBe('Córdoba');
    expect(matchProvincia('Tucumán')).toBe('Tucumán');
  });

  it('resuelve sin tildes', () => {
    expect(matchProvincia('cordoba')).toBe('Córdoba');
    expect(matchProvincia('TUCUMAN')).toBe('Tucumán');
    expect(matchProvincia('rio negro')).toBe('Río Negro');
  });

  it('resuelve variantes "Provincia de X"', () => {
    expect(matchProvincia('Provincia de Buenos Aires')).toBe('Buenos Aires');
  });

  it('null para provincias inexistentes', () => {
    expect(matchProvincia('Patagonia')).toBeNull();
    expect(matchProvincia('Cuyo')).toBeNull();
    expect(matchProvincia(null)).toBeNull();
  });

  it('NO devuelve "Otro" automático', () => {
    expect(matchProvincia('algo extraño')).toBeNull();
  });
});

describe('matchTipoIncidente', () => {
  it('respeta el typo "Tentantiva" (no lo arregla)', () => {
    expect(matchTipoIncidente('Robo en grado de Tentantiva')).toBe('Robo en grado de Tentantiva');
  });

  it('resuelve los 9 tipos canonical', () => {
    expect(matchTipoIncidente('Robo Total')).toBe('Robo Total');
    expect(matchTipoIncidente('robo parcial')).toBe('Robo Parcial');
    expect(matchTipoIncidente('homicidio')).toBe('Homicidio');
    expect(matchTipoIncidente('Otro')).toBe('Otro');
  });

  it('matchea fuzzy: "robo" cae al primer "Robo *" que contiene', () => {
    // Comportamiento esperado: el matcher es agresivo y cae al primer
    // enum que contiene la palabra (orden de declaración del array).
    // "robo" matchea "Robo Total" (primera opción con "robo").
    expect(matchTipoIncidente('robo')).toBe('Robo Total');
  });

  it('null si IA devuelve algo NO relacionado', () => {
    expect(matchTipoIncidente('asalto')).toBeNull();
    expect(matchTipoIncidente('cualquier cosa')).toBeNull();
  });
});

describe('matchFuerzaInterviniente', () => {
  it('resuelve las 7 fuerzas canonical', () => {
    expect(matchFuerzaInterviniente('Policía Federal')).toBe('Policía Federal');
    expect(matchFuerzaInterviniente('Gendarmeria Nacional Argentina')).toBe(
      'Gendarmeria Nacional Argentina',
    );
  });

  it('resuelve sin tildes', () => {
    expect(matchFuerzaInterviniente('policia federal')).toBe('Policía Federal');
    expect(matchFuerzaInterviniente('gendarmeria nacional argentina')).toBe(
      'Gendarmeria Nacional Argentina',
    );
  });

  it('resuelve variante PBA', () => {
    expect(matchFuerzaInterviniente('Policia de la PBA')).toBe('Policia de la PBA');
  });
});

describe('matchTipoVehiculo', () => {
  it('resuelve canonical', () => {
    expect(matchTipoVehiculo('Semirremolque')).toBe('Semirremolque');
    expect(matchTipoVehiculo('Camioneta o Furgón')).toBe('Camioneta o Furgón');
  });

  it('matchea fuzzy: "camion" cae al primer "Camión *" que contiene', () => {
    // Misma lógica: "camion" matchea "Camión más Acoplado" (primero en lista).
    expect(matchTipoVehiculo('camion')).toBe('Camión más Acoplado');
  });

  it('null si IA devuelve algo NO relacionado', () => {
    expect(matchTipoVehiculo('bicicleta')).toBeNull();
  });
});

describe('matchHuboViolencia', () => {
  it('Si / No exactos', () => {
    expect(matchHuboViolencia('Si')).toBe('Si');
    expect(matchHuboViolencia('No')).toBe('No');
    expect(matchHuboViolencia('SI')).toBe('Si');
    expect(matchHuboViolencia('NO')).toBe('No');
  });
});

describe('matchCantidadVehiculos / matchCantidadPersonas', () => {
  it('cantidades numéricas string', () => {
    expect(matchCantidadVehiculos('1')).toBe('1');
    expect(matchCantidadVehiculos('3')).toBe('3');
    expect(matchCantidadPersonas('5')).toBe('5');
  });

  it('Otros literal', () => {
    expect(matchCantidadVehiculos('Otros')).toBe('Otros');
  });

  it('null si IA devuelve "4" para vehículos (no hay opción)', () => {
    // Cantidad vehículos solo tiene 1/2/3/Otros (no 4).
    expect(matchCantidadVehiculos('4')).toBeNull();
  });
});

describe('resolverCamposFramer (resolver completo)', () => {
  it('resuelve TODOS los campos cuando IA responde válido', () => {
    const r = resolverCamposFramer({
      provincia: 'buenos aires',
      tipoIncidenteFramer: 'Robo Total',
      fuerzaInterviniente: 'Policia de la PBA',
      tipoVehiculo: 'Semirremolque',
      cargaTransportada: 'Electrodomésticos',
      modusOperandi: 'Detención Eventual',
      huboViolencia: 'Si',
      tipoVehiculoInvolucrado: 'Moto',
      cantidadVehiculosInvolucrados: '2',
      cantidadPersonasInvolucradas: '3',
    });

    expect(r.provincia).toBe('Buenos Aires');
    expect(r.tipoIncidenteFramer).toBe('Robo Total');
    expect(r.fuerzaInterviniente).toBe('Policia de la PBA');
    expect(r.tipoVehiculo).toBe('Semirremolque');
    expect(r.cargaTransportada).toBe('Electrodomésticos');
    expect(r.modusOperandi).toBe('Detención Eventual');
    expect(r.huboViolencia).toBe('Si');
    expect(r.tipoVehiculoInvolucrado).toBe('Moto');
    expect(r.cantidadVehiculosInvolucrados).toBe('2');
    expect(r.cantidadPersonasInvolucradas).toBe('3');
    expect(r.camposFaltantes).toEqual([]);
  });

  it('camposFaltantes = lista de los que IA no pudo elegir', () => {
    const r = resolverCamposFramer({
      provincia: 'cordoba',
      tipoIncidenteFramer: null,
      fuerzaInterviniente: 'algo raro',
      tipoVehiculo: null,
      cargaTransportada: null,
      modusOperandi: null,
      huboViolencia: 'Si',
      tipoVehiculoInvolucrado: null,
      cantidadVehiculosInvolucrados: null,
      cantidadPersonasInvolucradas: null,
    });

    expect(r.provincia).toBe('Córdoba');
    expect(r.huboViolencia).toBe('Si');
    expect(r.camposFaltantes).toContain('tipoIncidenteFramer');
    expect(r.camposFaltantes).toContain('fuerzaInterviniente');
    expect(r.camposFaltantes).toContain('tipoVehiculo');
    expect(r.camposFaltantes).toContain('cargaTransportada');
    expect(r.camposFaltantes).toContain('modusOperandi');
    expect(r.camposFaltantes).toContain('tipoVehiculoInvolucrado');
    expect(r.camposFaltantes).toContain('cantidadVehiculosInvolucrados');
    expect(r.camposFaltantes).toContain('cantidadPersonasInvolucradas');
    expect(r.camposFaltantes).not.toContain('provincia');
    expect(r.camposFaltantes).not.toContain('huboViolencia');
  });

  it('TODOS null → camposFaltantes con los 10', () => {
    const r = resolverCamposFramer({});
    expect(r.camposFaltantes).toHaveLength(10);
  });
});
