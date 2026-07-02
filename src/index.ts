import cron from 'node-cron';
import { ENV } from './config/env';
import { initSentry, captureException } from './lib/sentry';

// Sprint hardening 13-mejoras: init Sentry ANTES de cualquier otro import
// para capturar errores de boot. Idempotente: si DSN vacío, no-op.
initSentry();

import { iniciarWhatsApp, detenerWhatsApp } from './agents/whatsapp';
import { startDashboard } from './dashboard/server';
import { reintentarFramerPendientes } from './services/pipeline';
import { enviarHealthcheck, verificarSaludWaSilencioso } from './services/healthcheck';
// Sprint mejoras-flujo (2026-06-30): imports removidos por retire de publicarSitio.
import { backupDiario, backupWaSession } from './services/backups';
import { ejecutarChequeosIA } from './services/health-ai';
import logger from './services/logger';

// Sprint hardening: capturar excepciones uncaught a Sentry (best-effort).
process.on('uncaughtException', (err) => {
  logger.error(`[uncaughtException] ${err.message}`);
  captureException(err, { source: 'uncaughtException' });
});
process.on('unhandledRejection', (reason) => {
  logger.error(`[unhandledRejection] ${reason}`);
  captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    source: 'unhandledRejection',
  });
});

// Validar variables de entorno críticas antes de arrancar
const erroresEnv: string[] = [];
if (ENV.AI_PROVIDER === 'gemini' && !ENV.GEMINI_API_KEY) {
  erroresEnv.push('GEMINI_API_KEY requerida cuando AI_PROVIDER=gemini');
}
if (ENV.AI_PROVIDER === 'openai' && !ENV.OPENAI_API_KEY) {
  erroresEnv.push('OPENAI_API_KEY requerida cuando AI_PROVIDER=openai');
}
if (!ENV.DATABASE_URL) {
  erroresEnv.push('DATABASE_URL es requerida');
}
if (!ENV.WA_GROUP_NAME) {
  erroresEnv.push('WA_GROUP_NAME es requerida — nombre exacto del grupo (ej: "Mesa Pirateria Camiones")');
}
if (ENV.NODE_ENV === 'production' && !ENV.VARONE_WA_NUMBER) {
  erroresEnv.push('VARONE_WA_NUMBER es requerida en producción para enviar alertas');
}
if (ENV.NODE_ENV === 'production') {
  if (ENV.DASHBOARD_USER === 'varone') {
    erroresEnv.push('DASHBOARD_USER no puede ser el valor por defecto en producción');
  }
  if (ENV.DASHBOARD_PASS === 'varone2026') {
    erroresEnv.push('DASHBOARD_PASS no puede ser el valor por defecto en producción');
  }
}
if (erroresEnv.length > 0) {
  console.error('[Config] ERROR: Variables de entorno faltantes:');
  erroresEnv.forEach(e => console.error('  -', e));
  process.exit(1);
}

console.log('===========================================');
console.log('  Sistema Varone - Monitor de Seguridad Vial');
console.log('===========================================');
console.log(`  Entorno: ${ENV.NODE_ENV}`);
console.log(`  IA: ${ENV.AI_PROVIDER}`);
console.log(`  Grupo WA: ${ENV.WA_GROUP_NAME || '(no configurado)'}`);
console.log('===========================================\n');

// Conectar a la DB con reintentos antes de arrancar los agentes
async function conectarDB(intentos = 3): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  for (let i = 1; i <= intentos; i++) {
    try {
      await prisma.$connect();
      await prisma.$disconnect();
      console.log('[DB] Conexión verificada.');
      return;
    } catch (err) {
      const espera = Math.pow(2, i) * 1000;
      logger.error(`[DB] Intento ${i}/${intentos} fallido. Reintentando en ${espera / 1000}s...`);
      if (i === intentos) throw err;
      await new Promise(r => setTimeout(r, espera));
    }
  }
}

async function main() {
  await conectarDB().catch(err => {
    console.error('[DB] No se pudo conectar a la base de datos:', err);
    process.exit(1);
  });

  // Iniciar dashboard web
  startDashboard(3000);

  // Iniciar agente WhatsApp
  iniciarWhatsApp();

  // Cron: reintentar reportes pendientes de Framer cada 15 minutos
  cron.schedule('*/15 * * * *', async () => {
    await reintentarFramerPendientes();
  });

  // Cron: healthcheck diario a las 8:00 AM Argentina
  cron.schedule('0 8 * * *', async () => {
    await enviarHealthcheck();
  }, { timezone: 'America/Argentina/Buenos_Aires' });

  // Cron: verificación silenciosa del bot WA cada 5 min.
  // Solo alerta si detecta zombie (conectado sin mensajes >1h) o desconexión
  // persistente (>15 min sin reconectar). No spamea cuando todo está OK.
  cron.schedule('*/5 * * * *', async () => {
    await verificarSaludWaSilencioso();
  });

  // Sprint mejoras-flujo (2026-06-30): crons 9AM/21hs de `publicarSitio()`
  // eliminados. Eran del flow viejo (Framer Server API). Hoy el publisher
  // Playwright postea inmediato al aprobar — no hay "publish del sitio"
  // como paso intermedio.

  // Cron: backup diario de la DB a las 3:00 AM Argentina (hora de menor actividad).
  // El archivo va a backups/varone-YYYY-MM-DD.dump y se mantiene 30 días.
  // Sprint hardening 13-mejoras (2026-06-27): también backupea .wwebjs_auth
  // para no depender 100% del volumen Docker.
  cron.schedule('0 3 * * *', async () => {
    await backupDiario();
    await backupWaSession();
  }, { timezone: 'America/Argentina/Buenos_Aires' });

  // Sprint mapa (2026-06-27): cron diario de geocoding a las 4:00 AM Argentina
  // (después del backup). Procesa hasta GEOCODE_BATCH_SIZE ubicaciones nuevas
  // por corrida, respetando GEOCODE_THROTTLE_MS entre requests (Nominatim TOS).
  cron.schedule('0 4 * * *', async () => {
    const { geocodingBatchCron } = await import('./services/geocoder');
    await geocodingBatchCron();
  }, { timezone: 'America/Argentina/Buenos_Aires' });

  // Sprint scrapers-portales (2026-06-30): cron por portal (default cada 15h
  // override por env var por portal — regla #9 NO-HARDCODED).
  // Si DISABLE_SCRAPERS=1, los crons no se registran (dev / smoke / si rompen).
  if (ENV.DISABLE_SCRAPERS !== '1') {
    const portalCronEntries: Array<{ portal: string; schedule: string }> = [
      { portal: 'cronica',         schedule: ENV.PORTAL_CRONICA_CRON },
      { portal: 'diario-popular',  schedule: ENV.PORTAL_DIARIO_POPULAR_CRON },
      { portal: 'infobae',         schedule: ENV.PORTAL_INFOBAE_CRON },
      { portal: 'la-nacion',       schedule: ENV.PORTAL_LA_NACION_CRON },
      { portal: 'clarin',          schedule: ENV.PORTAL_CLARIN_CRON },
      { portal: 'pagina12',        schedule: ENV.PORTAL_PAGINA12_CRON },
    ];
    for (const { portal, schedule } of portalCronEntries) {
      cron.schedule(schedule, async () => {
        // Sprint admin-config (2026-06-30): antes de correr, verificamos que
        // Varone lo haya habilitado desde /configuracion. Si el toggle está
        // en false, skip silencioso.
        const { obtenerPortalesActivos } = await import('./services/config-admin');
        const activos = await obtenerPortalesActivos();
        if (!activos[portal as keyof typeof activos]) {
          logger.info(`[Cron portal ${portal}] skip — deshabilitado por config admin`);
          return;
        }
        try {
          const { correrScraperUno } = await import('./agents/portales');
          await correrScraperUno(portal);
        } catch (err) {
          logger.error(`[Cron portal ${portal}] ${err instanceof Error ? err.message : err}`);
        }
      }, { timezone: 'America/Argentina/Buenos_Aires' });
    }
    logger.info(`[Cron] ${portalCronEntries.length} scrapers registrados`);

    // Healthcheck portales: cron diario 10 AM Argentina.
    cron.schedule('0 10 * * *', async () => {
      try {
        const { chequearSaludPortales } = await import('./services/portales-healthcheck');
        await chequearSaludPortales();
      } catch (err) {
        logger.error(`[Cron portales-healthcheck] ${err instanceof Error ? err.message : err}`);
      }
    }, { timezone: 'America/Argentina/Buenos_Aires' });
  } else {
    logger.info('[Cron] Scrapers de portales DESHABILITADOS via DISABLE_SCRAPERS=1');
  }

  // Cron: chequeos de comportamiento de la IA cada hora.
  // Detecta 4 modos de falla del modo full-auto: silencio sospechoso, spike,
  // pendientes colgados, distribución sospechosa. Cada alerta tiene dedup de
  // 6h para no spamear cuando una condición persiste.
  cron.schedule('15 * * * *', async () => {
    await ejecutarChequeosIA();
  }, { timezone: 'America/Argentina/Buenos_Aires' });
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n[Sistema] Señal ${signal} recibida. Cerrando...`);
  detenerWhatsApp();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error('[Sistema] Unhandled rejection:', err);
});

main();
