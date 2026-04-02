import cron from 'node-cron';
import { ENV } from './config/env';
import { iniciarWhatsApp, detenerWhatsApp } from './agents/whatsapp';
import { iniciarScraper, detenerScraper } from './agents/scraper';
import { startDashboard } from './dashboard/server';
import { reintentarFramerPendientes } from './services/pipeline';

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
