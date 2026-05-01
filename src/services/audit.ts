/**
 * Audit log inmutable.
 *
 * Append-only: solo escribimos. Nunca se actualizan ni borran filas
 * (excepto por purga programada futura, fuera del runtime de la app).
 *
 * Diseñado para no fallar nunca: si la DB rechaza, lo logueamos pero
 * no lanzamos excepción — el flujo principal NO debe romperse porque
 * el audit no pudo escribir.
 */

import { Prisma } from '@prisma/client';
import prisma from './prisma';
import logger from './logger';

export type AuditOrigen =
  | 'panel'           // request desde varone-admin (cookie de sesion)
  | 'quick-action'    // link firmado HMAC desde WhatsApp
  | 'api-direct'      // llamada directa al backend con BACKEND_API_TOKEN
  | 'cron'            // cron del sistema (publish diario, backup, etc.)
  | 'system';         // procesos internos (pipeline, etc.)

export interface AuditEntry {
  evento: string;
  actor: string;
  origen: AuditOrigen;
  reporteId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Registra una entrada de audit log. Nunca lanza: si falla la escritura,
 * loguea el error y devuelve sin throw.
 */
export async function registrarAccion(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        evento: entry.evento.slice(0, 100),
        actor: entry.actor.slice(0, 200),
        origen: entry.origen,
        reporteId: entry.reporteId ?? null,
        ip: entry.ip?.slice(0, 64) ?? null,
        user_agent: entry.userAgent?.slice(0, 500) ?? null,
        // El cast a InputJsonValue es seguro: solo guardamos JSON-serializables.
        meta: entry.meta ? (entry.meta as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch (e) {
    // Audit log no debe romper el flujo. Solo logueamos.
    logger.error('[Audit] Error escribiendo audit log:', e);
  }
}

/**
 * Lista las últimas N entradas (default 100).
 * Filtros opcionales por reporteId, actor o evento.
 */
export async function listarAuditLog(opts?: {
  limit?: number;
  reporteId?: number;
  actor?: string;
  evento?: string;
}) {
  const where: Record<string, unknown> = {};
  if (opts?.reporteId) where.reporteId = opts.reporteId;
  if (opts?.actor) where.actor = opts.actor;
  if (opts?.evento) where.evento = { contains: opts.evento };

  const items = await prisma.auditLog.findMany({
    where,
    orderBy: { ts: 'desc' },
    take: Math.min(opts?.limit ?? 100, 500),
  });

  // BigInt → string para serializar (JSON.stringify no soporta BigInt nativamente).
  return items.map((i) => ({
    id: i.id.toString(),
    evento: i.evento,
    actor: i.actor,
    origen: i.origen,
    reporteId: i.reporteId,
    ip: i.ip,
    userAgent: i.user_agent,
    meta: i.meta,
    ts: i.ts.toISOString(),
  }));
}
