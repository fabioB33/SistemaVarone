/**
 * Tests del pre-filtro (Sprint scrapers-portales 2026-06-30).
 *
 * Casos críticos:
 *  1. El ejemplo Tartagal (RN 34 + Renault Duster + cocaína 70kg) → blacklist
 *  2. Asalto a camión genérico → ok
 *  3. Noticia sin keywords del nicho → sin-keywords
 *  4. Vehículos personales (auto, moto) → sin-keywords
 *  5. Casos compuestos
 */

import { describe, expect, it } from 'vitest';
import { preFiltrar, normalizar } from '../../src/services/prefiltro';

describe('normalizar', () => {
  it('lowercase + remove tildes', () => {
    expect(normalizar('Camión')).toBe('camion');
    expect(normalizar('PIRATERÍA')).toBe('pirateria');
  });

  it('signos → espacios, colapsa whitespace', () => {
    expect(normalizar('asalto, en ruta!  km 50')).toBe('asalto en ruta km 50');
  });
});

describe('preFiltrar — casos del nicho (whitelist)', () => {
  it('asalto a camión típico', () => {
    const r = preFiltrar('Asalto a camión en Acceso Sudeste, robaron mercadería');
    expect(r.pasa).toBe(true);
    expect(r.razon).toBe('ok');
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
  });

  it('robo de carga', () => {
    const r = preFiltrar('Robo de carga en Ruta 9. Cuatro delincuentes armados.');
    expect(r.pasa).toBe(true);
  });

  it('piratas del asfalto', () => {
    const r = preFiltrar('Piratas del asfalto interceptaron un trailer en RN 8.');
    expect(r.pasa).toBe(true);
    expect(r.matchedKeywords).toContain('piratas del asfalto');
  });

  it('chofer de camión', () => {
    const r = preFiltrar('El chofer del camión recibió un balazo en el brazo');
    expect(r.pasa).toBe(true);
  });

  it('semirremolque', () => {
    const r = preFiltrar('Asaltaron un semirremolque cargado con electrodomésticos');
    expect(r.pasa).toBe(true);
  });

  it('bloqueo de ruta', () => {
    const r = preFiltrar('Bloqueo de ruta en Panamericana km 50');
    expect(r.pasa).toBe(true);
  });
});

describe('preFiltrar — casos del NO-nicho (sin-keywords)', () => {
  it('noticia politica sin contexto vehicular', () => {
    const r = preFiltrar('El Congreso aprobó la nueva ley de presupuesto');
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('sin-keywords');
  });

  it('robo de auto particular', () => {
    const r = preFiltrar('Le robaron el auto a una vecina en Villa Crespo');
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('sin-keywords');
  });

  it('reseña fútbol', () => {
    const r = preFiltrar('Boca le ganó a River por 2-1 con gol en el último minuto');
    expect(r.pasa).toBe(false);
  });
});

describe('preFiltrar — descartes por blacklist', () => {
  it('CASO REAL Tartagal: asalto en RN 34 + cocaína 70kg', () => {
    // Texto extraído de la nota real del 2026-06-30 que dio origen al sprint.
    // Contiene whitelist (ruta, dispararon, Renault Duster) PERO también
    // blacklist (cocaína, doble fondo, mexicaneada).
    const texto = `Una denuncia por un supuesto asalto en la Ruta Nacional 34 derivó
      en el hallazgo de un cargamento de droga en Tartagal, Salta. Una médica de
      Gendarmería y una cosmetóloga fueron detenidas luego de que la Policía
      encontrara cerca de 70 kilos de cocaína ocultos en el vehículo en el que
      se trasladaban. Una camioneta blanca sin patente trasera las interceptó.
      Durante la inspección del rodado, los agentes detectaron que uno de los
      impactos habría desprendido parte de la chapa de un doble fondo en el baúl,
      donde quedaron a la vista varios paquetes de cocaína. Los investigadores
      también analizan la hipótesis de una "mexicaneada".`;

    const r = preFiltrar(texto);
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('blacklist');
    expect(r.matchedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/cocaína|cocaina|droga|doble fondo|mexicaneada/i)]),
    );
  });

  it('narcotráfico inequívoco', () => {
    const r = preFiltrar('Operativo de narcotráfico en Ruta 11. Asaltaron al chofer.');
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('blacklist');
  });

  it('homicidio sin contexto vehicular', () => {
    const r = preFiltrar('Investigan un homicidio cerca de la ruta provincial 6');
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('blacklist');
  });

  it('contrabando aduana', () => {
    const r = preFiltrar('La aduana incautó un camión con mercadería de contrabando');
    // Contiene whitelist (camión, mercadería) PERO blacklist (contrabando, aduana incautó).
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('blacklist');
  });

  it('cuatreros (animales)', () => {
    const r = preFiltrar('Cuatreros robaron 50 cabezas de ganado en Santiago del Estero');
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('blacklist');
  });
});

describe('preFiltrar — edge cases', () => {
  it('string vacío', () => {
    const r = preFiltrar('');
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('sin-keywords');
  });

  it('mayúsculas vs minúsculas', () => {
    const r = preFiltrar('CAMIÓN ASALTADO EN RUTA NACIONAL 9');
    expect(r.pasa).toBe(true);
  });

  it('caracteres con tildes', () => {
    const r = preFiltrar('Piratería del asfalto en Provincia de Buenos Aires');
    expect(r.pasa).toBe(true);
  });
});
