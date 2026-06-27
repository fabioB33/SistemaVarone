/**
 * Sprint hardening 13-mejoras (2026-06-27) — Sentry idle integration.
 *
 * Patrón canonical Pampa Labs (replica del proyecto noticias):
 * - Si `SENTRY_DSN` no está → no-op silencioso.
 * - Si está → init server-side + lazy require de @sentry/node.
 *
 * Lazy import: @sentry/node solo se carga si DSN existe. Esto evita
 * sumar peso de la SDK a arranques sin Sentry configurado.
 */

import { ENV } from '../config/env';

type SentryLike = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (err: unknown, ctx?: Record<string, unknown>) => void;
  captureMessage: (msg: string, level?: string) => void;
};

let _sentry: SentryLike | null = null;
let _initDone = false;

export function initSentry(): void {
  if (_initDone) return;
  _initDone = true;

  if (!ENV.SENTRY_DSN) {
    console.log('[Sentry] DSN no configurado. Observability idle.');
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sentry = require('@sentry/node') as SentryLike;
    sentry.init({
      dsn: ENV.SENTRY_DSN,
      environment: ENV.NODE_ENV,
      tracesSampleRate: ENV.NODE_ENV === 'production' ? 0.5 : 1.0,
      initialScope: {
        tags: {
          product: 'sistema-varone',
          runtime: 'node',
        },
      },
    });
    _sentry = sentry;
    console.log('[Sentry] Inicializado.');
  } catch {
    console.warn('[Sentry] @sentry/node no instalado. Para activar: npm install @sentry/node.');
    console.warn('[Sentry] Continuando sin observability.');
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!_sentry) return;
  _sentry.captureException(err, { extra: context });
}

export function captureMessage(msg: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!_sentry) return;
  _sentry.captureMessage(msg, level);
}
