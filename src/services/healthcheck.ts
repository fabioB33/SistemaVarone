import prisma from './prisma';
import { notificar } from './notificaciones';
import { getWaStatePersisted } from './wa-state';
import logger from './logger';
import { ENV } from '../config/env';

const TZ_AR = 'America/Argentina/Buenos_Aires';

// Healthcheck silencioso de WA — corre cada 5 min via cron.
// Solo alerta si detecta problemas, no manda mensaje cuando todo está OK.

// Umbral de inactividad antes de alertar: si el bot está conectado pero no
// recibió ningún mensaje en X horas, asumimos zombie y alertamos.
// Valor configurable por env (default 1h). Para grupos de baja actividad
// conviene subirlo (ej. 4h) para evitar falsos positivos.
const WA_ZOMBIE_THRESHOLD_MS =
  parseInt(process.env.WA_ZOMBIE_THRESHOLD_MIN || '60', 10) * 60_000;

// Throttle: no mandar la misma alerta más de 1 vez por hora para no spamear
// si el zombie persiste. Trackeado en memoria del proceso.
const ALERTA_COOLDOWN_MS = 60 * 60_000;
const ultimaAlertaPor: Record<string, number> = {};

function puedeAlertar(tipo: string): boolean {
  const ahora = Date.now();
  const ultima = ultimaAlertaPor[tipo];
  if (ultima && ahora - ultima < ALERTA_COOLDOWN_MS) return false;
  ultimaAlertaPor[tipo] = ahora;
  return true;
}

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

/**
 * Verificación liviana del estado del bot WA. Corre cada 5 min via cron.
 *
 * Detecta y alerta sobre 2 condiciones que el resto del sistema no cubre:
 *
 *  A) **Zombie**: bot dice estar conectado pero no recibe mensajes hace >1h.
 *     El watchdog del agente WA solo dispara después de 6h. Para uso operativo
 *     real, 6h es demasiado tiempo sin saber. Esto avisa antes.
 *
 *  B) **Disconnected persistente**: bot está desconectado y los reintentos
 *     automáticos no lograron levantarlo. La alerta del propio agente solo
 *     dispara tras 10 reintentos fallidos (1-2hs). Esto avisa a los 5 min.
 *
 * Silencioso cuando todo está OK — no spamea con confirmaciones.
 */
export async function verificarSaludWaSilencioso(): Promise<void> {
  try {
    const persisted = await getWaStatePersisted();
    if (!persisted) {
      // Nunca se persistió estado — primer arranque del backend, ignorar.
      return;
    }

    const ahora = Date.now();

    // Caso A: zombie (connected pero sin mensajes)
    if (persisted.status === 'connected') {
      const ultimoMensaje = persisted.ultimoMensajeEn?.getTime();
      if (!ultimoMensaje) {
        // Conectado hace mucho pero nunca llegó un mensaje — puede ser bot recién
        // conectado a un grupo silencioso. Solo alertamos si pasaron >2h desde
        // que se conectó (ultimoCambioEn).
        const desdeConexion = ahora - persisted.ultimoCambioEn.getTime();
        if (desdeConexion > 2 * WA_ZOMBIE_THRESHOLD_MS && puedeAlertar('zombie-sin-mensajes')) {
          const horas = Math.round(desdeConexion / 60_000 / 60);
          await notificar(
            `⚠️ *Sistema Varone* — Bot conectado hace ${horas}h pero sin mensajes recibidos.\nVerificá si el grupo "${ENV.WA_GROUP_NAME}" sigue activo o si el bot quedó zombie.`,
          ).catch(() => {});
          logger.warn(`[Healthcheck WA] Zombie detectado: conectado hace ${horas}h sin mensajes`);
        }
        return;
      }

      const inactividad = ahora - ultimoMensaje;
      if (inactividad > WA_ZOMBIE_THRESHOLD_MS && puedeAlertar('zombie-inactivo')) {
        const mins = Math.round(inactividad / 60_000);
        await notificar(
          `⚠️ *Sistema Varone* — Bot conectado pero sin actividad hace ${mins} min.\nÚltimo mensaje recibido: ${persisted.ultimoMensajeEn?.toLocaleString('es-AR', { timeZone: TZ_AR })}.\nPosible bot zombie. El watchdog automático lo va a reiniciar en breve.`,
        ).catch(() => {});
        logger.warn(`[Healthcheck WA] Inactividad ${mins}m supera umbral`);
      }
      return;
    }

    // Caso B: disconnected hace mucho
    if (persisted.status === 'disconnected') {
      const desdeDesconexion = ahora - persisted.ultimoCambioEn.getTime();
      // Solo alertar si lleva >15 min desconectado (el reconnect automático
      // tiene backoff hasta 5 min, dar margen para que reintente solo).
      if (desdeDesconexion > 15 * 60_000 && puedeAlertar('disconnected-persistente')) {
        const mins = Math.round(desdeDesconexion / 60_000);
        await notificar(
          `🔴 *Sistema Varone* — Bot desconectado hace ${mins} min y no logra reconectar.\nMotivo último: ${persisted.ultimoEvento || 'desconocido'}.\nIntervención manual recomendada (escanear QR desde el panel).`,
        ).catch(() => {});
        logger.warn(`[Healthcheck WA] Disconnect persistente: ${mins}m`);
      }
      return;
    }

    // status === 'qr' — esperando vinculación, no es problema. No alertar.
  } catch (e) {
    logger.error('[Healthcheck WA] Error verificando salud:', e);
  }
}
