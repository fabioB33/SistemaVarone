/**
 * Persistencia del estado del bot WhatsApp.
 *
 * Singleton en DB (fila con id=1). Los handlers del agente WA (ready,
 * disconnected, qr) llaman a setWaStateStatus() para persistir transiciones.
 *
 * Se usa en 2 lugares:
 *  1) Endpoint /api/wa/status — al arrancar el backend, el cliente WA tarda
 *     1-2 minutos en inicializar. Mientras tanto, devolvemos el último estado
 *     conocido + flag `cargando: true` para que el panel no muestre "limbo".
 *
 *  2) Healthcheck cron — compara `ultimoMensajeEn` con Date.now() para detectar
 *     bots conectados pero zombies que no reciben mensajes hace >1h.
 *
 * Diseño defensivo: si la DB falla, ninguna función lanza — el flujo principal
 * del bot no debe romperse porque la persistencia esté offline.
 */

import { Prisma } from '@prisma/client';
import prisma from './prisma';
import logger from './logger';

export type WaStatus = 'connected' | 'qr' | 'disconnected';

export interface WaStatePersisted {
  status: WaStatus;
  ultimoCambioEn: Date;
  ultimoMensajeEn: Date | null;
  ultimoEvento: string | null;
  detalles: Record<string, unknown> | null;
}

const SINGLETON_ID = 1;

/**
 * Persiste un cambio de estado. Idempotente y silencioso ante errores.
 */
export async function setWaStateStatus(
  status: WaStatus,
  evento: string,
  detalles?: Record<string, unknown>,
): Promise<void> {
  try {
    const data = {
      status,
      ultimoEvento: evento.slice(0, 100),
      ultimoCambioEn: new Date(),
      detalles: detalles ? (detalles as Prisma.InputJsonValue) : Prisma.JsonNull,
    };
    await prisma.waState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
  } catch (e) {
    logger.error('[WaState] Error persistiendo status:', e);
  }
}

/**
 * Bumpea `ultimoMensajeEn` para marcar actividad. Llamado por el agente WA
 * cada vez que recibe un mensaje del grupo (incluso si el mensaje es ignorado
 * por el filtro). Sirve para detectar zombies en el healthcheck.
 */
export async function bumpWaStateUltimoMensaje(): Promise<void> {
  try {
    await prisma.waState.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        status: 'connected',
        ultimoMensajeEn: new Date(),
      },
      update: { ultimoMensajeEn: new Date() },
    });
  } catch (e) {
    logger.error('[WaState] Error bumpeando ultimoMensajeEn:', e);
  }
}

/**
 * Devuelve el último estado conocido. Null si nunca se persistió o falla DB.
 */
export async function getWaStatePersisted(): Promise<WaStatePersisted | null> {
  try {
    const row = await prisma.waState.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (!row) return null;
    return {
      status: row.status as WaStatus,
      ultimoCambioEn: row.ultimoCambioEn,
      ultimoMensajeEn: row.ultimoMensajeEn,
      ultimoEvento: row.ultimoEvento,
      detalles: row.detalles as Record<string, unknown> | null,
    };
  } catch (e) {
    logger.error('[WaState] Error leyendo wa_state:', e);
    return null;
  }
}
