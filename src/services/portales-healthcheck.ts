/**
 * Sprint scrapers-portales (2026-06-30) — Healthcheck portales.
 *
 * Cron diario 10 AM Argentina: para cada portal, contar:
 *  - reportes generados (estado != descartado) en las últimas 24h
 *  - notas descartadas por el pre-filtro (para auditoría)
 *
 * Si UN portal trajo 0 reportes + 0 descartes en 24h → probable scraper roto
 * (HTML cambió, redirección, etc.). Alerta WhatsApp / Telegram.
 *
 * Si UN portal trajo MUCHOS descartes y 0 reportes → quizás la whitelist está
 * mal calibrada (Varone tiene que mirar /descartados y tunear keywords).
 *
 * Las alertas usan la tabla `Alerta` existente con `tipo='portales-healthcheck'`
 * para que aparezcan en el badge del topbar.
 */

import logger from './logger';
import prisma from './prisma';
import { SCRAPERS } from '../agents/portales';
import { notificar } from './notificaciones';

interface PortalStats {
  portal: string;
  reportes24h: number;
  descartados24h: number;
}

export async function chequearSaludPortales(): Promise<PortalStats[]> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stats: PortalStats[] = [];

  for (const portal of Object.keys(SCRAPERS)) {
    const [reportes24h, descartados24h] = await Promise.all([
      prisma.reporte.count({
        where: {
          portalOrigen: portal,
          creadoEn: { gte: desde },
        },
      }),
      prisma.scrapeDescartado.count({
        where: {
          portal,
          descartadoEn: { gte: desde },
        },
      }),
    ]);

    stats.push({ portal, reportes24h, descartados24h });
  }

  // Reglas de alertado:
  //  1. portal trajo 0 + 0 → scraper probable roto
  //  2. portal trajo 0 reportes + >=5 descartes → revisar whitelist
  const problemas: string[] = [];
  for (const s of stats) {
    if (s.reportes24h === 0 && s.descartados24h === 0) {
      problemas.push(`⚠ ${s.portal}: 0 notas en 24h. Scraper probable roto.`);
    } else if (s.reportes24h === 0 && s.descartados24h >= 5) {
      problemas.push(`💡 ${s.portal}: ${s.descartados24h} notas descartadas, 0 al pipeline. Revisar whitelist.`);
    }
  }

  logger.info(`[portales-healthcheck] stats: ${JSON.stringify(stats)}`);

  if (problemas.length > 0) {
    const mensaje = `🚦 *Sistema Varone — Healthcheck portales*\n\n${problemas.join('\n')}`;
    logger.warn(`[portales-healthcheck] ${problemas.length} alertas: ${problemas.join('; ')}`);

    try {
      await prisma.alerta.create({
        data: {
          tipo: 'portales-healthcheck',
          mensaje,
          severidad: 'warn',
          // Cast intermedio para satisfacer Prisma InputJsonValue
          // (stats es PortalStats[] que sin Index signature falla).
          meta: { stats, problemas } as unknown as object,
        },
      });
    } catch (e) {
      logger.warn(`[portales-healthcheck] no se pudo persistir alerta: ${e instanceof Error ? e.message : e}`);
    }

    await notificar(mensaje).catch(() => {});
  }

  return stats;
}
