/**
 * Sprint admin-config (2026-06-30) — Service para leer/escribir config editable
 * desde el panel admin.
 *
 * Config keys canonical:
 *  - portales.activos: { clarin: true, cronica: true, ... }
 *  - portales.custom: [{ nombre, url, activo }]
 *  - whatsapp.group_name: string
 *
 * Todas son opcionales — si no están seteadas en DB, caemos al default del
 * .env (regla #9 NO-HARDCODED). Los `set*` invalidan un cache in-memory.
 */

import prisma from './prisma';
import { ENV } from '../config/env';
import logger from './logger';

// ─── Cache in-memory (TTL 30s) ──────────────────────────────────────────
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    cache.delete(key);
    return null;
  }
  return cached.value as T;
}

function setCached(key: string, value: unknown): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Force-invalidate cache (usado por los `set*`). */
export function invalidarConfigCache(): void {
  cache.clear();
}

// ─── Portales activos ───────────────────────────────────────────────────

export const PORTALES_KEYS = ['clarin', 'cronica', 'diario-popular', 'infobae', 'la-nacion', 'pagina12'] as const;
export type PortalKey = typeof PORTALES_KEYS[number];

export type PortalesActivos = Partial<Record<PortalKey, boolean>>;

const PORTALES_ACTIVOS_DEFAULT: Record<PortalKey, boolean> = {
  clarin: true,
  cronica: true,
  'diario-popular': true,
  infobae: true,
  'la-nacion': true,
  pagina12: true,
};

export async function obtenerPortalesActivos(): Promise<Record<PortalKey, boolean>> {
  const cached = getCached<Record<PortalKey, boolean>>('portales.activos');
  if (cached) return cached;

  try {
    const row = await prisma.configAdmin.findUnique({ where: { key: 'portales.activos' } });
    const stored = (row?.value as PortalesActivos) ?? {};
    const merged: Record<PortalKey, boolean> = { ...PORTALES_ACTIVOS_DEFAULT, ...stored };
    setCached('portales.activos', merged);
    return merged;
  } catch (err) {
    logger.warn(`[ConfigAdmin] obtenerPortalesActivos error, fallback a defaults: ${err instanceof Error ? err.message : err}`);
    return PORTALES_ACTIVOS_DEFAULT;
  }
}

export async function setPortalesActivos(
  activos: Partial<Record<PortalKey, boolean>>,
  editorPor: string,
): Promise<void> {
  await prisma.configAdmin.upsert({
    where: { key: 'portales.activos' },
    create: { key: 'portales.activos', value: activos, updatedBy: editorPor, descripcion: 'Portales del scraper habilitados' },
    update: { value: activos, updatedBy: editorPor },
  });
  invalidarConfigCache();
  logger.info(`[ConfigAdmin] portales.activos actualizado por ${editorPor}: ${JSON.stringify(activos)}`);
}

// ─── WhatsApp group name ────────────────────────────────────────────────

export async function obtenerWaGroupName(): Promise<string> {
  const cached = getCached<string>('whatsapp.group_name');
  if (cached) return cached;

  try {
    const row = await prisma.configAdmin.findUnique({ where: { key: 'whatsapp.group_name' } });
    const value = (row?.value as string | undefined) ?? ENV.WA_GROUP_NAME ?? '';
    setCached('whatsapp.group_name', value);
    return value;
  } catch (err) {
    logger.warn(`[ConfigAdmin] obtenerWaGroupName error, fallback a env: ${err instanceof Error ? err.message : err}`);
    return ENV.WA_GROUP_NAME || '';
  }
}

export async function setWaGroupName(groupName: string, editorPor: string): Promise<void> {
  await prisma.configAdmin.upsert({
    where: { key: 'whatsapp.group_name' },
    create: {
      key: 'whatsapp.group_name',
      value: groupName,
      updatedBy: editorPor,
      descripcion: 'Nombre exacto del grupo de WhatsApp a monitorear',
    },
    update: { value: groupName, updatedBy: editorPor },
  });
  invalidarConfigCache();
  logger.info(`[ConfigAdmin] whatsapp.group_name actualizado por ${editorPor}: "${groupName}"`);
}

// ─── Snapshot completo (para UI) ────────────────────────────────────────

export interface ConfigAdminSnapshot {
  portales: {
    activos: Record<PortalKey, boolean>;
    disponibles: readonly PortalKey[];
  };
  whatsapp: {
    groupName: string;
    groupNameEnv: string; // default del .env, para mostrar en UI
  };
}

export async function obtenerConfigSnapshot(): Promise<ConfigAdminSnapshot> {
  const [portalesActivos, waGroupName] = await Promise.all([
    obtenerPortalesActivos(),
    obtenerWaGroupName(),
  ]);
  return {
    portales: {
      activos: portalesActivos,
      disponibles: PORTALES_KEYS,
    },
    whatsapp: {
      groupName: waGroupName,
      groupNameEnv: ENV.WA_GROUP_NAME || '',
    },
  };
}
