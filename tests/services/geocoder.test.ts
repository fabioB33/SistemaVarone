/**
 * Tests del geocoder (Sprint mapa 2026-06-27).
 *
 * Valida la construcción de queries para Nominatim. No mockea fetch
 * (tests integration-level requeririan Nominatim mock server), nos
 * concentramos en la lógica pura del buildQuery que es donde está la
 * mayor probabilidad de bugs.
 */

import { describe, expect, it } from 'vitest';
import { buildQuery, simplificarUbicacion } from '../../src/services/geocoder';

describe('buildQuery', () => {
  it('arma query con ubicación + ruta + provincia', () => {
    expect(buildQuery('Acceso Sudeste km 12', 'AU 3', 'Buenos Aires')).toBe(
      'Acceso Sudeste km 12, AU 3, Buenos Aires, Argentina',
    );
  });

  it('omite ruta si es null', () => {
    expect(buildQuery('Quilmes', null, 'Buenos Aires')).toBe('Quilmes, Buenos Aires, Argentina');
  });

  it('omite provincia si es null', () => {
    expect(buildQuery('Rosario', 'RN9', null)).toBe('Rosario, RN9, Argentina');
  });

  it('siempre agrega "Argentina" al final para bias geográfico', () => {
    const q = buildQuery('San Justo', null, null);
    expect(q.endsWith('Argentina')).toBe(true);
  });

  it('filtra strings vacías para no generar ", ,"', () => {
    // Caso defensivo: si el caller pasa string vacía en lugar de null
    expect(buildQuery('Mendoza', '', '')).toBe('Mendoza, Argentina');
  });

  it('preserva acentos en ubicación', () => {
    expect(buildQuery('Río Cuarto', null, 'Córdoba')).toBe('Río Cuarto, Córdoba, Argentina');
  });

  // Sprint 2026-07-08 (fix Bug 1): filtra strings de ruido que la IA
  // a veces guarda como valor literal.
  describe('sanitización strings ruido IA (Sprint 2026-07-08)', () => {
    it('filtra "no especificada" del campo ruta', () => {
      expect(buildQuery('Lomas de Zamora', 'no especificada', 'Buenos Aires')).toBe(
        'Lomas de Zamora, Buenos Aires, Argentina',
      );
    });

    it('filtra "no especificada" del campo provincia', () => {
      expect(buildQuery('Merlo', null, 'no especificada')).toBe('Merlo, Argentina');
    });

    it('filtra "sin datos" (variante)', () => {
      expect(buildQuery('Rosario', 'sin datos', 'Santa Fe')).toBe(
        'Rosario, Santa Fe, Argentina',
      );
    });

    it('filtra "N/A"', () => {
      expect(buildQuery('Villa Fiorito', 'N/A', 'Buenos Aires')).toBe(
        'Villa Fiorito, Buenos Aires, Argentina',
      );
    });

    it('es case-insensitive', () => {
      expect(buildQuery('Quilmes', 'NO ESPECIFICADA', null)).toBe('Quilmes, Argentina');
    });

    it('preserva valores válidos aunque tengan mayúsculas', () => {
      // "RN 3" y similares deben pasar.
      expect(buildQuery('Chubut', 'RN 3', 'Chubut')).toBe(
        'Chubut, RN 3, Chubut, Argentina',
      );
    });
  });
});

// Sprint 2026-07-08 (fix Bug 3): simplifica ubicaciones compuestas para
// fallback cuando Nominatim rechaza la forma completa.
describe('simplificarUbicacion', () => {
  it('extrae la primera localidad de un string con varias separadas por coma', () => {
    expect(simplificarUbicacion('Azul, Saladillo, Olavarría, Hinojo, Chillar')).toBe('Azul');
  });

  it('extrae la primera parte de un string separado por barra', () => {
    expect(simplificarUbicacion('Luján de Cuyo / Perdriel')).toBe('Luján de Cuyo');
  });

  it('extrae la primera localidad ignorando "barrio X"', () => {
    expect(simplificarUbicacion('Olavarría, barrio Independencia')).toBe('Olavarría');
  });

  it('extrae la primera localidad de "X, La Matanza" tipo contexto', () => {
    expect(simplificarUbicacion('Isidro Casanova, La Matanza')).toBe('Isidro Casanova');
  });

  it('retorna null si no hay simplificación posible (nombre canónico)', () => {
    expect(simplificarUbicacion('Lomas de Zamora')).toBeNull();
  });

  it('retorna null si el resultado es demasiado corto', () => {
    expect(simplificarUbicacion('Km, ruta 3')).toBeNull();
  });

  it('descarta prefijos de contexto: "barrio", "localidad", "cerca de"', () => {
    expect(simplificarUbicacion('barrio Independencia, Olavarría')).toBe('Independencia');
  });

  it('retorna null para string vacío', () => {
    expect(simplificarUbicacion('')).toBeNull();
  });
});
