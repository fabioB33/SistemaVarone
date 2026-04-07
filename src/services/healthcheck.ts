import prisma from './prisma';
import { notificar } from './notificaciones';

const TZ_AR = 'America/Argentina/Buenos_Aires';

/**
 * Healthcheck diario: resume actividad del día anterior y confirma que el sistema está vivo.
 * Si este mensaje no llega por la mañana, algo está mal.
 */
export async function enviarHealthcheck(): Promise<void> {
  try {
    const ahora = new Date();
    const ayer = new Date(ahora);
    ayer.setDate(ayer.getDate() - 1);
    ayer.setHours(0, 0, 0, 0);
    const hoy = new Date(ahora);
    hoy.setHours(0, 0, 0, 0);

    // Reportes del día anterior
    const totalAyer = await prisma.reporte.count({
      where: { creadoEn: { gte: ayer, lt: hoy } },
    });

    const porFuente = await prisma.reporte.groupBy({
      by: ['fuente'],
      where: { creadoEn: { gte: ayer, lt: hoy } },
      _count: { fuente: true },
    });

    const porGravedad = await prisma.reporte.groupBy({
      by: ['gravedad'],
      where: { creadoEn: { gte: ayer, lt: hoy }, gravedad: { not: null } },
      _count: { gravedad: true },
    });

    // Framer pendientes
    const framerPendientes = await prisma.reporte.count({
      where: { framerEnviado: false, framerIntentos: { lt: 5 } },
    });

    const fechaAyer = ayer.toLocaleDateString('es-AR', { timeZone: TZ_AR, day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaActual = ahora.toLocaleTimeString('es-AR', { timeZone: TZ_AR, hour: '2-digit', minute: '2-digit' });

    const fuenteTexto = porFuente.map(f => `  • ${f.fuente}: ${f._count.fuente}`).join('\n') || '  • Sin reportes';
    const gravedadTexto = porGravedad.map(g => `  • ${g.gravedad}: ${g._count.gravedad}`).join('\n') || '  • Sin datos';

    const alertaFramer = framerPendientes > 0
      ? `\n⚠️ *Framer pendientes:* ${framerPendientes} reportes sin enviar`
      : '';

    const msg = [
      `✅ *Sistema Varone — Reporte diario*`,
      `📅 Ayer (${fechaAyer}): *${totalAyer} reportes*`,
      ``,
      `Por fuente:\n${fuenteTexto}`,
      ``,
      `Por gravedad:\n${gravedadTexto}`,
      alertaFramer,
      ``,
      `🕐 Generado: ${horaActual}hs`,
    ].filter(l => l !== undefined).join('\n');

    await notificar(msg);
    console.log(`[Healthcheck] Reporte diario enviado — ${totalAyer} reportes ayer.`);
  } catch (e) {
    console.error('[Healthcheck] Error generando reporte diario:', e);
  }
}
