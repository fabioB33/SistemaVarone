/**
 * Tests del geocoder (Sprint mapa 2026-06-27).
 *
 * Valida la construcción de queries para Nominatim. No mockea fetch
 * (tests integration-level requeririan Nominatim mock server), nos
 * concentramos en la lógica pura del buildQuery que es donde está la
 * mayor probabilidad de bugs.
 */

import { describe, expect, it } from 'vitest';
import { buildQuery } from '../../src/services/geocoder';

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
});
