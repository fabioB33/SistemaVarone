import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  // Base de datos
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/sistema_varone',

  // IA (Gemini o OpenAI)
  AI_PROVIDER: (process.env.AI_PROVIDER || 'gemini') as 'gemini' | 'openai',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // WhatsApp
  WA_GROUP_NAME: process.env.WA_GROUP_NAME || '',

  // Framer (microservicio framer-publisher en ESM aislado)
  FRAMER_PUBLISHER_URL: process.env.FRAMER_PUBLISHER_URL || 'http://127.0.0.1:4001',
  FRAMER_PUBLISHER_TOKEN: process.env.FRAMER_PUBLISHER_TOKEN || '',
  // Legacy: webhook directo (se usa solo si FRAMER_PUBLISHER_URL no está disponible)
  FRAMER_ENDPOINT: process.env.FRAMER_ENDPOINT || '',

  // Dashboard
  DASHBOARD_USER: process.env.DASHBOARD_USER || 'varone',
  DASHBOARD_PASS: process.env.DASHBOARD_PASS || 'varone2026',
  // Token de bypass para llamadas server-to-server (varone-admin → backend).
  // Si está seteado y un request trae el header X-Backend-Token con ese valor,
  // pasa la auth sin necesidad de cookie/sesión.
  BACKEND_API_TOKEN: process.env.BACKEND_API_TOKEN || '',

  // Secret para firmar tokens de "quick action" (links Aprobar/Descartar
  // que Varone recibe por WhatsApp). HMAC-SHA256, mínimo 32 chars.
  QUICK_ACTION_SECRET: process.env.QUICK_ACTION_SECRET || '',

  // URL pública del panel admin (para armar los links de notificaciones).
  // En dev: http://localhost:3001. En prod: https://admin.tudominio.com
  ADMIN_PUBLIC_URL: process.env.ADMIN_PUBLIC_URL || 'http://localhost:3001',

  // Alertas Telegram (opcional — si no se configura, solo logea)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // Número de WhatsApp para alertas operacionales (formato internacional sin +)
  VARONE_WA_NUMBER: process.env.VARONE_WA_NUMBER || '5491144462389',

  // Sprint hardening 13-mejoras (2026-06-27): observabilidad opcional.
  // Si vacío, lib/sentry.ts queda idle (no-op).
  SENTRY_DSN: process.env.SENTRY_DSN || '',

  // Sprint mapa + rate-limit (2026-06-27): caps configurables vía env.
  // Si no se setean, defaults razonables del middleware aplican.
  RATE_LIMIT_MUTATIONS_PER_MIN: parseInt(process.env.RATE_LIMIT_MUTATIONS_PER_MIN || '', 10) || 0,
  RATE_LIMIT_PUBLISHER_PER_MIN: parseInt(process.env.RATE_LIMIT_PUBLISHER_PER_MIN || '', 10) || 0,
  RATE_LIMIT_LOGIN_PER_15MIN: parseInt(process.env.RATE_LIMIT_LOGIN_PER_15MIN || '', 10) || 0,
  RATE_LIMIT_INYECCION_PER_MIN: parseInt(process.env.RATE_LIMIT_INYECCION_PER_MIN || '', 10) || 0,
  RATE_LIMIT_PUBLIC_PER_MIN: parseInt(process.env.RATE_LIMIT_PUBLIC_PER_MIN || '', 10) || 0,

  // Sprint mapa (2026-06-27): geocoding config.
  // Nominatim oficial es free pero requiere User-Agent identificable y
  // throttle 1 req/seg. Self-host con docker si necesitás más volumen.
  NOMINATIM_BASE_URL: process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
  NOMINATIM_USER_AGENT: process.env.NOMINATIM_USER_AGENT || 'sistema-varone/1.0 (https://pirateriadecamiones.com.ar)',
  // ms entre requests a Nominatim. TOS pide >= 1000.
  GEOCODE_THROTTLE_MS: parseInt(process.env.GEOCODE_THROTTLE_MS || '', 10) || 1100,
  // Cuántas ubicaciones nuevas geocodear por corrida del cron.
  GEOCODE_BATCH_SIZE: parseInt(process.env.GEOCODE_BATCH_SIZE || '', 10) || 50,

  // Sprint scrapers-portales (2026-06-30):
  // Pre-filtro extensible vía env vars (regla #9 NO-HARDCODED).
  // Lista separada por comas: 'extra1,extra2,extra3'.
  PREFILTRO_WHITELIST_EXTRA: process.env.PREFILTRO_WHITELIST_EXTRA || '',
  PREFILTRO_BLACKLIST_EXTRA: process.env.PREFILTRO_BLACKLIST_EXTRA || '',

  // Cron expressions por portal. Default: cada 15h.
  // Override por portal si Varone quiere distinta cadencia.
  PORTAL_CRONICA_CRON:        process.env.PORTAL_CRONICA_CRON        || '0 */15 * * *',
  PORTAL_DIARIO_POPULAR_CRON: process.env.PORTAL_DIARIO_POPULAR_CRON || '0 */15 * * *',
  PORTAL_INFOBAE_CRON:        process.env.PORTAL_INFOBAE_CRON        || '0 */15 * * *',
  PORTAL_LA_NACION_CRON:      process.env.PORTAL_LA_NACION_CRON      || '0 */15 * * *',
  PORTAL_CLARIN_CRON:         process.env.PORTAL_CLARIN_CRON         || '0 */15 * * *',
  PORTAL_PAGINA12_CRON:       process.env.PORTAL_PAGINA12_CRON       || '0 */15 * * *',

  // Toggle global para desactivar scrapers (smoke / dev / si los portales rompen).
  DISABLE_SCRAPERS: process.env.DISABLE_SCRAPERS || '',

  // User-Agent identificable que mandamos en los requests al portal (cortesía
  // + permite que el portal nos contacte si abusamos).
  SCRAPER_USER_AGENT: process.env.SCRAPER_USER_AGENT
    || 'sistema-varone/1.0 (https://pirateriadecamiones.com.ar contacto@xxx)',

  // Máximo de notas por scrape, por portal (defensivo).
  SCRAPER_MAX_NOTAS_POR_PORTAL: parseInt(process.env.SCRAPER_MAX_NOTAS_POR_PORTAL || '20', 10),

  // General
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
