/**
 * Backups automáticos de la DB.
 *
 * Ejecuta `pg_dump` en formato custom (-Fc) que es compresible y
 * restaurable con `pg_restore`. Los archivos van a `BACKUP_DIR`
 * (default: `<sistema-varone>/backups/`).
 *
 * Retención: configurable por `BACKUP_RETAIN_DAYS` (default: 30).
 *
 * Restore manual:
 *   pg_restore -U <user> -h <host> -d <db> -c backups/varone-2026-05-01.dump
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ENV } from '../config/env';
import { notificar } from './notificaciones';
import logger from './logger';

const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve('backups');
const BACKUP_RETAIN_DAYS = parseInt(process.env.BACKUP_RETAIN_DAYS || '30', 10);
const PG_DUMP_TIMEOUT_MS = 5 * 60_000; // 5min — la DB es chica, debería tardar segundos

interface BackupInfo {
  filename: string;
  size: number;
  createdAt: Date;
}

function parseDatabaseUrl(url: string) {
  // postgresql://user:pass@host:port/database
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/([^?]+)/);
  if (!m) throw new Error('DATABASE_URL inválido');
  return {
    user: decodeURIComponent(m[1]),
    pass: decodeURIComponent(m[2]),
    host: m[3],
    port: m[4] || '5432',
    database: m[5].split('?')[0],
  };
}

/**
 * Ejecuta un backup ahora. Devuelve el path del archivo creado.
 */
export async function ejecutarBackup(): Promise<{ ok: true; file: string; size: number } | { ok: false; error: string }> {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const cfg = parseDatabaseUrl(ENV.DATABASE_URL);

    const fecha = new Date().toISOString().slice(0, 10);
    const filename = `varone-${fecha}.dump`;
    const filepath = path.join(BACKUP_DIR, filename);

    // pg_dump -Fc (custom, binario, comprimido)
    return await new Promise((resolve) => {
      const args = [
        '-h', cfg.host,
        '-p', cfg.port,
        '-U', cfg.user,
        '-d', cfg.database,
        '-Fc',
        '-f', filepath,
      ];
      const child = spawn('pg_dump', args, {
        env: { ...process.env, PGPASSWORD: cfg.pass },
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ ok: false, error: `pg_dump timeout tras ${PG_DUMP_TIMEOUT_MS}ms` });
      }, PG_DUMP_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: `pg_dump no disponible: ${err.message}` });
      });

      child.on('exit', async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ ok: false, error: `pg_dump exit ${code}: ${stderr.trim().slice(0, 200)}` });
          return;
        }
        try {
          const stat = await fs.stat(filepath);
          resolve({ ok: true, file: filepath, size: stat.size });
        } catch (e) {
          resolve({ ok: false, error: `No se pudo leer ${filepath}: ${e}` });
        }
      });
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Borra backups con más de RETAIN_DAYS días. Devuelve cuántos borró.
 */
export async function aplicarRetencion(): Promise<number> {
  try {
    const files = await fs.readdir(BACKUP_DIR).catch(() => []);
    const cutoff = Date.now() - BACKUP_RETAIN_DAYS * 24 * 60 * 60_000;
    let borrados = 0;
    for (const f of files) {
      if (!f.startsWith('varone-') || !f.endsWith('.dump')) continue;
      const filepath = path.join(BACKUP_DIR, f);
      const stat = await fs.stat(filepath).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.unlink(filepath).catch(() => {});
        borrados++;
      }
    }
    return borrados;
  } catch {
    return 0;
  }
}

/**
 * Lista los backups existentes con tamaño y fecha de creación.
 */
export async function listarBackups(): Promise<BackupInfo[]> {
  try {
    const files = await fs.readdir(BACKUP_DIR).catch(() => []);
    const out: BackupInfo[] = [];
    for (const f of files) {
      if (!f.startsWith('varone-') || !f.endsWith('.dump')) continue;
      const filepath = path.join(BACKUP_DIR, f);
      const stat = await fs.stat(filepath).catch(() => null);
      if (!stat) continue;
      out.push({ filename: f, size: stat.size, createdAt: stat.mtime });
    }
    out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return out;
  } catch {
    return [];
  }
}

/**
 * Backup orquestado: ejecuta dump + retención + notifica resultado.
 * Pensado para ser llamado desde un cron diario.
 */
export async function backupDiario(): Promise<void> {
  logger.info('[Backup] Iniciando backup diario...');
  const result = await ejecutarBackup();

  if (!result.ok) {
    logger.error('[Backup] Error:', result.error);
    await notificar(`🚨 *Sistema Varone* — Backup falló: ${result.error}`).catch(() => {});
    return;
  }

  const sizeMb = (result.size / (1024 * 1024)).toFixed(2);
  const borrados = await aplicarRetencion();
  logger.info(`[Backup] OK ${result.file} (${sizeMb} MB), retención borró ${borrados} archivos viejos`);

  // Solo notificar al usuario si algo cambió mucho (DB inusualmente chica → posible corrupción)
  // o cada N días. Por default no spam: el log es suficiente.
}

/**
 * Sprint hardening 13-mejoras (2026-06-27) — Backup del session storage de
 * whatsapp-web.js (.wwebjs_auth/). Sin esto, si el container se reinicia con
 * volumen perdido, Varone tiene que volver a escanear el QR → downtime del bot.
 *
 * Estrategia: tar.gz del directorio + guardar al lado de los backups DB.
 * Sobrevivir restart del container es responsabilidad del volumen Docker;
 * acá cubrimos el caso "pérdida total del volumen" (raro pero catastrófico).
 */
export async function backupWaSession(): Promise<{ ok: boolean; file?: string; size?: number; error?: string }> {
  try {
    const { execSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const path = await import('node:path');

    // Path canonical del session storage de whatsapp-web.js
    // (relativo a CWD del backend — siempre `products/sistema-varone/`).
    const sessionDir = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(sessionDir)) {
      logger.warn('[Backup] .wwebjs_auth no existe (bot WA nunca corrió). Skip.');
      return { ok: false, error: 'sessionDir-missing' };
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const outDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `wa-session-${dateStr}.tar.gz`);

    // tar -czf (z=gzip, c=create, f=file). cwd para evitar paths absolutos
    // adentro del tar.
    execSync(`tar -czf "${outFile}" .wwebjs_auth`, {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    const stats = fs.statSync(outFile);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    logger.info(`[Backup] WA session OK ${path.basename(outFile)} (${sizeMb} MB)`);
    return { ok: true, file: outFile, size: stats.size };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Backup] WA session falló: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Stats de backups para mostrar en panel.
 */
export async function statsBackups(): Promise<{
  total: number;
  ultimoBackup: string | null;
  tamañoTotal: number;
  retainDays: number;
}> {
  const items = await listarBackups();
  const tamañoTotal = items.reduce((acc, i) => acc + i.size, 0);
  return {
    total: items.length,
    ultimoBackup: items[0]?.createdAt.toISOString() ?? null,
    tamañoTotal,
    retainDays: BACKUP_RETAIN_DAYS,
  };
}
