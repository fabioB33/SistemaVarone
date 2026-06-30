/**
 * Sprint scrapers-portales (2026-06-30) — Cliente HTTP compartido.
 *
 * Envuelve fetch con:
 *  - User-Agent identificable (regla #9 env var)
 *  - timeout duro (los portales suelen colgar)
 *  - retries con exponential backoff para errores transient (5xx, network)
 *  - tipos de error semánticos para que el orchestrator decida qué hacer
 */

import { ENV } from '../../../config/env';
import logger from '../../../services/logger';

const TIMEOUT_MS = 15_000;
const MAX_INTENTOS = 3;

export class ScraperHttpError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(message);
    this.name = 'ScraperHttpError';
  }
}

export interface FetchResult {
  url: string;
  status: number;
  body: string;
}

async function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchHtml(url: string, opts?: { timeoutMs?: number }): Promise<FetchResult> {
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;
  let lastError: unknown = null;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const controller = new AbortController();
      const tHandle = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': ENV.SCRAPER_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-AR,es;q=0.9',
        },
        signal: controller.signal,
      });
      clearTimeout(tHandle);

      // 4xx (excepto 429) son no-retryables: el scraper sigue roto hasta fix.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new ScraperHttpError(`HTTP ${res.status} ${res.statusText}`, res.status, false);
      }

      // 5xx + 429 → retry
      if (res.status >= 500 || res.status === 429) {
        throw new ScraperHttpError(`HTTP ${res.status} ${res.statusText}`, res.status, true);
      }

      const body = await res.text();
      return { url, status: res.status, body };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ScraperHttpError ? err.retryable : true; // network errs → retry
      logger.warn(
        `[ScraperHttp] intento ${intento}/${MAX_INTENTOS} fallo (${url}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      if (!retryable || intento === MAX_INTENTOS) break;

      // Backoff: 2s, 8s
      const espera = 2_000 * Math.pow(4, intento - 1);
      await dormir(espera);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
