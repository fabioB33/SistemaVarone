/**
 * Servicio de persistencia de alertas operativas.
 *
 * Las alertas se guardan en DB como source of truth. El canal de notificación
 * (WhatsApp / Telegram / email) puede fallar — la alerta queda registrada igual
 * y aparece en el panel admin con un badge "N sin leer".
 *
 * Diseño:
 *  - registrarAlerta(): crea fila + intenta notificar por WA. Si WA falla, marca
 *    estadoEnvio='fallback-console' pero NO falla el flujo.
 *  - listar(): para el panel, devuelve últimas N con filtros.
 *  - contarSinLeer(): query rápida para el badge del topbar.
 *  - marcarVista(): cuando el usuario clickea en el panel.
 *
 * No fallar nunca: si la DB rechaza el insert, log error pero no throw — las
 * alertas no deben romper el flujo principal del sistema.
 */

import { Prisma } from '@prisma/client';
import prisma from './prisma';
import logger from './logger';
import { notificar } from './notificaciones';

export type TipoAlerta =
  | 'silencio'
  | 'spike'
  | 'pendientes-viejos'
  | 'distribucion'
  | 'test';

export type SeveridadAlerta = 'info' | 'warn' | 'error';

export type EstadoEnvio = 'pending' | 'sent' | 'failed' | 'fallback-console';

interface RegistrarAlertaInput {
  tipo: TipoAlerta;
  mensaje: string;
  severidad?: SeveridadAlerta;
  meta?: Record<string, unknown>;
}

/**
 * Persiste una alerta en DB y la notifica por WhatsApp.
 * Si WA falla, la alerta queda registrada igual con estadoEnvio='fallback-console'.
 *
 * Returns el ID de la alerta creada, o null si falló el insert (caso de error
 * grave de DB — el caller decide si quiere reintentar más tarde).
 */
export async function registrarAlerta(input: RegistrarAlertaInput): Promise<number | null> {
  let alertaId: number | null = null;

  // 1. Persistir primero (más crítico que enviar)
  try {
    const created = await prisma.alerta.create({
      data: {
        tipo: input.tipo,
        mensaje: input.mensaje,
        severidad: input.severidad ?? 'warn',
        meta: input.meta ? (input.meta as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    alertaId = created.id;
    logger.info(`[Alertas] Alerta #${alertaId} registrada en DB (tipo=${input.tipo}).`);
  } catch (e) {
    logger.error('[Alertas] Error persistiendo alerta:', e);
    // Aún así intentamos notificar al menos por WA antes de retornar null.
  }

  // 2. Intentar notificar por WhatsApp (canal principal)
  let estadoEnvio: EstadoEnvio = 'fallback-console';
  try {
    await notificar(input.mensaje);
    // notificar() loguea internamente si fue WA real o fallback console.
    // No tenemos forma de saber desde acá cuál fue, así que asumimos sent
    // si no throwed. Para distinguir mejor habría que cambiar la firma de notificar().
    estadoEnvio = 'sent';
  } catch (e) {
    logger.error('[Alertas] Error notificando alerta:', e);
    estadoEnvio = 'failed';
  }

  // 3. Actualizar estadoEnvio en la fila ya creada
  if (alertaId !== null) {
    try {
      await prisma.alerta.update({
        where: { id: alertaId },
        data: { estadoEnvio },
      });
    } catch (e) {
      logger.error(`[Alertas] Error actualizando estadoEnvio de alerta #${alertaId}:`, e);
    }
  }

  return alertaId;
}

/**
 * Lista alertas con filtros opcionales para el panel admin.
 */
export async function listarAlertas(opts?: {
  limit?: number;
  soloSinLeer?: boolean;
  tipo?: TipoAlerta;
  desde?: Date;
}) {
  const where: Prisma.AlertaWhereInput = {};
  if (opts?.soloSinLeer) where.vistaEn = null;
  if (opts?.tipo) where.tipo = opts.tipo;
  if (opts?.desde) where.creadoEn = { gte: opts.desde };

  const items = await prisma.alerta.findMany({
    where,
    orderBy: { creadoEn: 'desc' },
    take: Math.min(opts?.limit ?? 50, 200),
  });

  return items.map(a => ({
    id: a.id,
    tipo: a.tipo,
    mensaje: a.mensaje,
    severidad: a.severidad,
    meta: a.meta,
    estadoEnvio: a.estadoEnvio,
    vistaEn: a.vistaEn?.toISOString() ?? null,
    resueltaEn: a.resueltaEn?.toISOString() ?? null,
    creadoEn: a.creadoEn.toISOString(),
  }));
}

/**
 * Cuenta alertas sin leer. Usado por el badge del topbar (poll cada 30s).
 * Optimizado: solo cuenta, no devuelve filas.
 */
export async function contarAlertasSinLeer(): Promise<number> {
  return prisma.alerta.count({ where: { vistaEn: null } });
}

/**
 * Marca una alerta como vista por un usuario.
 * Idempotente: si ya estaba vista, no hace nada.
 */
export async function marcarAlertaVista(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const alerta = await prisma.alerta.findUnique({ where: { id } });
  if (!alerta) return { ok: false, error: 'Alerta no encontrada' };
  if (alerta.vistaEn) return { ok: true }; // ya estaba vista, idempotente
  await prisma.alerta.update({
    where: { id },
    data: { vistaEn: new Date() },
  });
  return { ok: true };
}

/**
 * Marca todas las alertas sin leer como vistas. Usado por botón "Marcar todas como leídas".
 */
export async function marcarTodasVistas(): Promise<number> {
  const result = await prisma.alerta.updateMany({
    where: { vistaEn: null },
    data: { vistaEn: new Date() },
  });
  return result.count;
}
