import cron from 'node-cron';
import { ENV } from './config/env';
import { iniciarWhatsApp, detenerWhatsApp } from './agents/whatsapp';
import { startDashboard } from './dashboard/server';
import { reintentarFramerPendientes } from './services/pipeline';
import { enviarHealthcheck, verificarSaludWaSilencioso } from './services/healthcheck';
import { publicarSitio } from './services/framer';
import { marcarPublicadosTrasPublish } from './services/aprobacion';
import { backupDiario } from './services/backups';
import logger from './services/logger';

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

  // Cron: publish diario del sitio Framer a las 9:00 AM Argentina.
  // Toma todos los reportes 'aprobado' con framerItemId y hace público el sitio.
  cron.schedule('0 9 * * *', async () => {
    logger.info('[Cron] Iniciando publicación diaria del sitio Framer...');
    const result = await publicarSitio();
    if (!result) {
      logger.error('[Cron] Falló la publicación diaria del sitio.');
      return;
    }
    const promovidos = await marcarPublicadosTrasPublish();
    logger.info(`[Cron] Sitio publicado (${result.deploymentId}). Reportes promovidos: ${promovidos}`);
  }, { timezone: 'America/Argentina/Buenos_Aires' });

  // Cron: backup diario de la DB a las 3:00 AM Argentina (hora de menor actividad).
  // El archivo va a backups/varone-YYYY-MM-DD.dump y se mantiene 30 días.
  cron.schedule('0 3 * * *', async () => {
    await backupDiario();
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
