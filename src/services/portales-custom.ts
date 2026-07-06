/**
 * Sprint portales-custom (2026-07-06) — CRUD de portales custom (agregados
 * por Varone desde el panel /configuracion).
 *
 * Consumido por:
 *  - src/agents/portales/index.ts → orchestrator los suma a SCRAPERS al arrancar
 *    y refresca cada 5 min por si Varone agregó/quitó uno
 *  - src/dashboard/server.ts → endpoints /api/admin/portales-custom/*
 */

import prisma from './prisma';
import logger from './logger';

export interface PortalCustomInput {
  slug: string;
  nombre: string;
  url: string;
  cardSelector?: string | null;
  linkSelector?: string | null;
  titleSelector?: string | null;
}

export interface PortalCustomRow {
  id: number;
  slug: string;
  nombre: string;
  url: string;
  cardSelector: string;
  linkSelector: string | null;
  titleSelector: string | null;
  activo: boolean;
  ultimoScrapeOk: Date | null;
  agregadoPor: string;
  creadoEn: Date;
}

const DEFAULT_CARD_SELECTOR = "article, .card, .news, [class*='article']";

// ─── Validaciones ──────────────────────────────────────────────────────

export function validarSlug(slug: string): string | null {
  if (!slug) return 'slug requerido';
  if (slug.length < 3 || slug.length > 40) return 'slug debe tener entre 3 y 40 chars';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'slug solo puede tener letras minúsculas, números y guiones';
  return null;
}

export function validarUrl(url: string): string | null {
  if (!url) return 'url requerida';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'url debe usar http o https';
    }
  } catch {
    return 'url inválida';
  }
  return null;
}

export function slugify(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip tildes
    .replace(/[^a-z0-9]+/g, '-')      // no-alfanum → guión
    .replace(/^-+|-+$/g, '')          // trim guiones
    .slice(0, 40);
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function listarPortalesCustom(): Promise<PortalCustomRow[]> {
  const rows = await prisma.portalCustom.findMany({
    orderBy: { creadoEn: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nombre: r.nombre,
    url: r.url,
    cardSelector: r.cardSelector,
    linkSelector: r.linkSelector,
    titleSelector: r.titleSelector,
    activo: r.activo,
    ultimoScrapeOk: r.ultimoScrapeOk,
    agregadoPor: r.agregadoPor,
    creadoEn: r.creadoEn,
  }));
}

export async function crearPortalCustom(
  input: PortalCustomInput,
  agregadoPor: string,
): Promise<{ ok: true; portal: PortalCustomRow } | { ok: false; error: string }> {
  // Auto-generar slug si no vino
  const slug = input.slug || slugify(input.nombre);
  const errSlug = validarSlug(slug);
  if (errSlug) return { ok: false, error: errSlug };
  const errUrl = validarUrl(input.url);
  if (errUrl) return { ok: false, error: errUrl };
  if (!input.nombre || input.nombre.trim().length < 2) {
    return { ok: false, error: 'nombre requerido (mínimo 2 chars)' };
  }

  // Slug conflicta con los hardcoded?
  const SLUGS_HARDCODED = new Set([
    'clarin',
    'cronica',
    'diario-popular',
    'infobae',
    'la-nacion',
    'pagina12',
  ]);
  if (SLUGS_HARDCODED.has(slug)) {
    return { ok: false, error: `El slug "${slug}" está reservado para un portal built-in` };
  }

  // Slug conflicta con otro custom?
  const existente = await prisma.portalCustom.findUnique({ where: { slug } });
  if (existente) {
    return { ok: false, error: `Ya existe un portal con slug "${slug}"` };
  }

  const row = await prisma.portalCustom.create({
    data: {
      slug,
      nombre: input.nombre.trim(),
      url: input.url.trim(),
      cardSelector: (input.cardSelector || DEFAULT_CARD_SELECTOR).trim(),
      linkSelector: input.linkSelector?.trim() || null,
      titleSelector: input.titleSelector?.trim() || null,
      activo: true,
      agregadoPor,
    },
  });

  logger.info(`[PortalesCustom] Portal "${slug}" agregado por ${agregadoPor}`);

  return {
    ok: true,
    portal: {
      id: row.id,
      slug: row.slug,
      nombre: row.nombre,
      url: row.url,
      cardSelector: row.cardSelector,
      linkSelector: row.linkSelector,
      titleSelector: row.titleSelector,
      activo: row.activo,
      ultimoScrapeOk: row.ultimoScrapeOk,
      agregadoPor: row.agregadoPor,
      creadoEn: row.creadoEn,
    },
  };
}

export async function togglePortalCustom(
  id: number,
  activo: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.portalCustom.update({ where: { id }, data: { activo } });
    logger.info(`[PortalesCustom] Portal #${id} → activo=${activo}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error al toggle' };
  }
}

export async function eliminarPortalCustom(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.portalCustom.delete({ where: { id } });
    logger.info(`[PortalesCustom] Portal #${id} eliminado`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error al eliminar' };
  }
}

/**
 * Registra un scrape exitoso (>=1 nota) — llamado desde el orchestrator.
 * Usado por healthcheck para saber cuál portal no trae nada hace mucho.
 */
export async function marcarUltimoScrapeOk(slug: string): Promise<void> {
  await prisma.portalCustom.updateMany({
    where: { slug },
    data: { ultimoScrapeOk: new Date() },
  }).catch(() => {}); // best-effort, si el portal no está en DB (built-in), ignora
}

/**
 * Devuelve los portales custom ACTIVOS listos para pasarle al buildGenericScraper.
 * Usado por el orchestrator al arrancar y en cada refresh (cada 5 min).
 */
export async function obtenerPortalesCustomActivos(): Promise<
  Array<{
    slug: string;
    nombre: string;
    url: string;
    cardSelector: string;
    linkSelector: string | null;
    titleSelector: string | null;
  }>
> {
  const rows = await prisma.portalCustom.findMany({ where: { activo: true } });
  return rows.map((r) => ({
    slug: r.slug,
    nombre: r.nombre,
    url: r.url,
    cardSelector: r.cardSelector,
    linkSelector: r.linkSelector,
    titleSelector: r.titleSelector,
  }));
}
