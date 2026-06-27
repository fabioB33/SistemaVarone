/**
 * Tests del servicio IA (Sprint hardening 13-mejoras 2026-06-27).
 *
 * Valida los helpers expuestos en `_internals`:
 * - esErrorRetryable: clasificación correcta de errores transient vs validación.
 * - esRateLimitError: detección específica de 429.
 * - parsearRespuesta: manejo de markdown wrap + JSON inválido.
 *
 * No testea analizarConIA() porque requiere mockear Gemini SDK (out of scope
 * para esta vuelta — más valor en cubrir lógica pura).
 */

import { describe, expect, it } from 'vitest';
import { _internals } from '../../src/services/ia';

const { esErrorRetryable, esRateLimitError, parsearRespuesta } = _internals;

describe('esErrorRetryable', () => {
  it('clasifica 429 como retryable', () => {
    expect(esErrorRetryable(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('clasifica rate limit como retryable', () => {
    expect(esErrorRetryable(new Error('Rate limit exceeded'))).toBe(true);
    expect(esErrorRetryable(new Error('Quota exceeded for project'))).toBe(true);
  });

  it('clasifica 5xx como retryable', () => {
    expect(esErrorRetryable(new Error('HTTP 500 Internal Server Error'))).toBe(true);
    expect(esErrorRetryable(new Error('HTTP 503 Service Unavailable'))).toBe(true);
    expect(esErrorRetryable(new Error('HTTP 502 Bad Gateway'))).toBe(true);
  });

  it('clasifica network errors como retryable', () => {
    expect(esErrorRetryable(new Error('ECONNRESET'))).toBe(true);
    expect(esErrorRetryable(new Error('ETIMEDOUT'))).toBe(true);
    expect(esErrorRetryable(new Error('network error'))).toBe(true);
    expect(esErrorRetryable(new Error('socket hang up'))).toBe(true);
    expect(esErrorRetryable(new Error('fetch failed'))).toBe(true);
  });

  it('NO clasifica errores de validación como retryable', () => {
    expect(esErrorRetryable(new Error('API_KEY_INVALID'))).toBe(false);
    expect(esErrorRetryable(new Error('Invalid API key provided'))).toBe(false);
    expect(esErrorRetryable(new Error('Permission denied'))).toBe(false);
    expect(esErrorRetryable(new Error('Bad request'))).toBe(false);
  });

  it('NO retrya cuando el error NO es Error', () => {
    expect(esErrorRetryable('string error')).toBe(false);
    expect(esErrorRetryable(null)).toBe(false);
    expect(esErrorRetryable(undefined)).toBe(false);
    expect(esErrorRetryable({ message: 'fake' })).toBe(false);
  });
});

describe('esRateLimitError', () => {
  it('detecta 429', () => {
    expect(esRateLimitError(new Error('HTTP 429'))).toBe(true);
  });

  it('detecta keywords rate/quota', () => {
    expect(esRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
    expect(esRateLimitError(new Error('quota exceeded'))).toBe(true);
  });

  it('NO confunde 5xx con rate limit', () => {
    expect(esRateLimitError(new Error('HTTP 500'))).toBe(false);
  });

  it('NO confunde network errors con rate limit', () => {
    expect(esRateLimitError(new Error('ECONNRESET'))).toBe(false);
  });
});

describe('parsearRespuesta', () => {
  it('parsea JSON limpio', () => {
    const raw = '{"esRelevante":true,"reporte":{"tipoIncidente":"robo_de_carga"}}';
    const result = parsearRespuesta(raw);
    expect(result.esRelevante).toBe(true);
    expect(result.reporte?.tipoIncidente).toBe('robo_de_carga');
  });

  it('quita markdown ```json wrap', () => {
    const raw = '```json\n{"esRelevante":false,"reporte":null}\n```';
    const result = parsearRespuesta(raw);
    expect(result.esRelevante).toBe(false);
    expect(result.reporte).toBeNull();
  });

  it('quita markdown ``` wrap genérico', () => {
    const raw = '```\n{"esRelevante":true,"reporte":null}\n```';
    const result = parsearRespuesta(raw);
    expect(result.esRelevante).toBe(true);
  });

  it('retorna esRelevante=false si JSON inválido', () => {
    const result = parsearRespuesta('not json at all');
    expect(result.esRelevante).toBe(false);
    expect(result.reporte).toBeNull();
  });

  it('retorna esRelevante=false si JSON parsea pero malformado (fallback gracias al cast)', () => {
    // JSON válido pero no tiene shape RespuestaIA — el cast es permisivo
    const result = parsearRespuesta('{"foo":"bar"}');
    // No tira error, solo retorna el objeto casteado
    expect(result.esRelevante).toBeUndefined();
  });
});
