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

  // General
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
