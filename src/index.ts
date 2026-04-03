import cron from 'node-cron';
import { ENV } from './config/env';
import { iniciarWhatsApp, detenerWhatsApp } from './agents/whatsapp';
import { iniciarScraper, detenerScraper } from './agents/scraper';
import { startDashboard } from './dashboard/server';
import { reintentarFramerPendientes } from './services/pipeline';

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
console.log(`  Scraping cada: ${ENV.SCRAPING_INTERVAL_MINUTES} minutos`);
console.log('===========================================\n');

// Iniciar dashboard web
startDashboard(3000);

// Iniciar agentes
iniciarWhatsApp();
iniciarScraper();

// Cron: reintentar reportes pendientes de Framer cada 15 minutos
cron.schedule('*/15 * * * *', async () => {
  await reintentarFramerPendientes();
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n[Sistema] Señal ${signal} recibida. Cerrando...`);
  detenerWhatsApp();
  await detenerScraper();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[Sistema] Unhandled rejection:', err);
});
