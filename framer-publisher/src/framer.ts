/**
 * Cliente Framer Server API.
 *
 * Encapsula la conexión persistente, el mapeo de campos, y las operaciones
 * de inserción y publicación del sitio "Pirateria de Camiones".
 *
 * Conexión long-lived: connect() abre una conexión que se mantiene viva
 * hasta disconnect(). Reusamos la misma instancia en todo el proceso.
 */

import { connect } from 'framer-api';

// ─── Constantes del proyecto Pirateria de Camiones ──────────────────────────
// IDs reales verificados con test de lectura (29-04-2026).

export const COLLECTION_NOTAS_NAME = 'Notas';

export const FIELDS = {
  count: 'xuCWj2PxF',
  link: 'J_BhGvTkl',
  title: 'Hgs5O8YeX',
  date: 'TE7spDCRc',
  image: 'Cqhvg02KQ',
  category: 'iQ95KYJD5',
  metaDescription: 'J5_khMKmF',
  featured: 'zQgYslUHR',
  content: 'BglBTdqjf',
} as const;

export const CATEGORY_ENUM = {
  News: 'oO9Mqkgic',
  Technology: 'sf5CDkxhV',
  Lifestyle: 'lEY9IcFA1',
  Health: 'HthAyrD9P',
  Education: 'Kyt7mghD8',
  Travel: 'gGZYBOJMG',
  Food: 'OqhsUg8nh',
  Fashion: 'Y6vnh5M1K',
} as const;

// ─── Tipos de input ─────────────────────────────────────────────────────────

export interface PublishInput {
  /** Título de la noticia (campo Title). */
  title: string;
  /** URL de la fuente original (campo Link). */
  link: string;
  /** Fecha en formato YYYY-MM-DD (campo Date). */
  date: string;
  /** Cuerpo HTML/markdown de la noticia (campo Content, formattedText). */
  content: string;
  /** Resumen corto (campo Meta Description). */
  metaDescription: string;
  /** Slug único (URL amigable). */
  slug: string;
  /** URL de imagen a usar en el campo Image (opcional, debe ser URL pública). */
  imageUrl?: string;
  /** Featured flag (default false). */
  featured?: boolean;
}

export interface PublishResult {
  itemId: string;
  slug: string;
  count: number;
}

// ─── Conexión singleton con auto-reconexión ─────────────────────────────────

let framerConnPromise: ReturnType<typeof connect> | null = null;

function getFramer() {
  if (framerConnPromise) return framerConnPromise;

  const projectUrl = process.env.FRAMER_PROJECT_URL;
  const apiKey = process.env.FRAMER_API_KEY;
  if (!projectUrl) throw new Error('FRAMER_PROJECT_URL no configurado');
  if (!apiKey) throw new Error('FRAMER_API_KEY no configurado');

  framerConnPromise = connect(projectUrl, apiKey);
  return framerConnPromise;
}

/**
 * Resetea la conexión singleton. Se invoca cuando detectamos errores de
 * "Connection closed" para forzar una nueva conexión en el próximo getFramer().
 */
function resetConnection(): void {
  framerConnPromise = null;
}

/**
 * Wrapper que ejecuta una operación contra Framer y reintenta una vez si la
 * conexión está cerrada. El SDK de framer-api a veces cierra la conexión tras
 * inactividad y la singleton queda en estado inválido.
 */
async function withReconnect<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Connection closed') || msg.includes('disconnected')) {
      console.warn('[framer] conexión cerrada, reconectando y reintentando...');
      resetConnection();
      return await op();
    }
    throw err;
  }
}

export async function disconnectFramer(): Promise<void> {
  if (!framerConnPromise) return;
  try {
    const f = await framerConnPromise;
    await f.disconnect();
  } catch {
    // ignorar
  }
  framerConnPromise = null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getNotasCollection() {
  const framer = await getFramer();
  const collections = await framer.getCollections();
  const notas = collections.find(
    (c) => c.name.toLowerCase() === COLLECTION_NOTAS_NAME.toLowerCase(),
  );
  if (!notas) {
    throw new Error(`Collection "${COLLECTION_NOTAS_NAME}" no encontrada`);
  }
  return notas;
}

async function getNextCount(): Promise<number> {
  const notas = await getNotasCollection();
  const items = await notas.getItems();
  let max = 0;
  for (const it of items as any[]) {
    const v = it.fieldData?.[FIELDS.count]?.value;
    if (typeof v === 'number' && v > max) max = v;
  }
  return max + 1;
}

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Crea un item nuevo en la Collection "Notas".
 * No publica el sitio: el item queda en draft hasta que llamemos a publishSite().
 */
export async function publishNoticia(input: PublishInput): Promise<PublishResult> {
  return withReconnect(async () => {
  const notas = await getNotasCollection();
  const count = await getNextCount();

  const fieldData: Record<string, unknown> = {
    [FIELDS.count]: { type: 'number', value: count },
    [FIELDS.title]: { type: 'string', value: input.title },
    [FIELDS.link]: { type: 'link', value: input.link },
    [FIELDS.date]: { type: 'date', value: input.date },
    [FIELDS.metaDescription]: { type: 'string', value: input.metaDescription },
    [FIELDS.featured]: { type: 'boolean', value: input.featured ?? false },
    [FIELDS.content]: { type: 'formattedText', value: input.content },
    [FIELDS.category]: { type: 'enum', value: CATEGORY_ENUM.News },
  };

  if (input.imageUrl) {
    // Framer acepta URL pública en campos image; el servidor la ingesta.
    fieldData[FIELDS.image] = { type: 'image', value: input.imageUrl };
  }

  await notas.addItems([{ slug: input.slug, fieldData } as any]);

  // Verificar y devolver
  const itemsAfter = await notas.getItems();
  const created = (itemsAfter as any[]).find((i) => i.slug === input.slug);
  if (!created) throw new Error('Item no encontrado luego de addItems');

  return { itemId: created.id, slug: created.slug, count };
  });
}

/**
 * Borra un item de la collection "Notas" por su itemId.
 * No publica el sitio — para que el cambio sea visible en el sitio público
 * hay que llamar después a publishSite().
 *
 * Retorna true si el borrado fue exitoso, false si el item no existía.
 */
export async function removeNoticia(itemId: string): Promise<boolean> {
  return withReconnect(async () => {
    const notas = await getNotasCollection();
    // Verificar primero que el item existe (evita errores opacos del SDK).
    const items = await notas.getItems();
    const exists = (items as any[]).some((i) => i.id === itemId);
    if (!exists) return false;
    await notas.removeItems([itemId]);
    return true;
  });
}

/**
 * Publica el sitio: genera un preview link y lo promueve a producción.
 * Re-publica todo el sitio con los cambios pendientes en CMS.
 */
export async function publishSite(): Promise<{ deploymentId: string }> {
  return withReconnect(async () => {
  const framer = await getFramer();
  console.log('[framer] llamando a framer.publish()...');
  let result;
  try {
    result = await framer.publish();
  } catch (e) {
    console.error('[framer] framer.publish() falló:', e);
    if (e instanceof Error) {
      console.error('  message:', e.message);
      console.error('  stack:', e.stack);
      console.error('  cause:', (e as { cause?: unknown }).cause);
    }
    throw e;
  }
  console.log('[framer] publish OK, deployment:', result?.deployment?.id);
  console.log('[framer] llamando a framer.deploy()...');
  try {
    await framer.deploy(result.deployment.id);
  } catch (e) {
    console.error('[framer] framer.deploy() falló:', e);
    if (e instanceof Error) {
      console.error('  message:', e.message);
      console.error('  stack:', e.stack);
    }
    throw e;
  }
  console.log('[framer] deploy OK');
  return { deploymentId: result.deployment.id };
  });
}

/**
 * Lista los items actuales de Notas (útil para healthcheck).
 */
export async function listNoticias(): Promise<
  Array<{ id: string; slug: string; title: string; count: number }>
> {
  return withReconnect(async () => {
    const notas = await getNotasCollection();
    const items = await notas.getItems();
    return (items as any[]).map((i) => ({
      id: i.id,
      slug: i.slug,
      title: i.fieldData?.[FIELDS.title]?.value ?? '',
      count: i.fieldData?.[FIELDS.count]?.value ?? 0,
    }));
  });
}
