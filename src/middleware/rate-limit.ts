/**
 * Sprint mapa + rate-limit (2026-06-27) — Rate limiting middleware.
 *
 * Express-rate-limit centralizado con 3 tiers según sensibilidad:
 *
 *  - mutations:   POST/PUT/DELETE que escriben en DB (aprobar/editar/descartar)
 *                 → 30 req/min por IP. Si un token se compromete y un atacante
 *                 dispara aprobaciones masivas, lo cortamos antes de que sature
 *                 al publisher.
 *
 *  - publisher:   POST que disparan el framer-publisher (reintentar)
 *                 → 10 req/min. Es el cuello de botella real (Playwright
 *                 abriendo browser, llenando form, esperando submit). Más
 *                 restrictivo que mutations puras.
 *
 *  - login:       /api/login y otros endpoints con auth
 *                 → 10 intentos / 15 min por IP. Anti-brute-force.
 *
 *  - inyeccion:   /api/inyectar-mensaje (backdoor manual cuando bot WA caído)
 *                 → 60 req/min. Permisivo porque a veces hay que inyectar
 *                 ráfagas (catch-up post-restart), pero igual cap por si hay
 *                 abuso.
 *
 * Reglas (regla #9 NO-HARDCODED): todos los umbrales son env vars con defaults
 * razonables. Si Varone tiene un caso de uso atípico (catch-up masivo, demo),
 * sube los caps en .env sin tocar código.
 */

import rateLimit from 'express-rate-limit';
import { ENV } from '../config/env';

/** Helper: respuesta JSON consistente con el resto del backend. */
const handler = (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
  res.status(429).json({
    ok: false,
    error: 'Demasiados intentos. Esperá un minuto y volvé a probar.',
  });
};

const baseConfig = {
  standardHeaders: true,   // RateLimit-* headers (estándar IETF)
  legacyHeaders: false,    // sin X-RateLimit-* viejos
  handler,
};

/**
 * Para mutations comunes (aprobar/editar/descartar/marcar-vista).
 */
export const mutationsLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000,
  max: ENV.RATE_LIMIT_MUTATIONS_PER_MIN || 30,
});

/**
 * Para acciones que disparan el publisher (Playwright = lento + costoso).
 */
export const publisherLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000,
  max: ENV.RATE_LIMIT_PUBLISHER_PER_MIN || 10,
});

/**
 * Para /api/login — anti-brute-force.
 */
export const loginLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,  // 15 min
  max: ENV.RATE_LIMIT_LOGIN_PER_15MIN || 10,
  // No contar requests que pasaron auth (skipSuccessfulRequests).
  // Así, si vos te equivocaste de pass 5 veces y la 6ta es correcta,
  // empezás de cero.
  skipSuccessfulRequests: true,
});

/**
 * Para /api/inyectar-mensaje — backdoor manual.
 */
export const inyeccionLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000,
  max: ENV.RATE_LIMIT_INYECCION_PER_MIN || 60,
});

/**
 * Para endpoints públicos (futuro: /api/public/incidentes).
 * No usado todavía pero exportado para Sprint+1 (#13 API pública).
 */
export const publicLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000,
  max: ENV.RATE_LIMIT_PUBLIC_PER_MIN || 100,
});
