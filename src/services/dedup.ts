import logger from './logger';
import crypto from 'crypto';
import prisma from './prisma';

function generarHash(texto: string): string {
  const normalizado = texto.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalizado).digest('hex');
}

export async function existeDuplicado(texto: string, urlNoticia?: string): Promise<boolean> {
  const hash = generarHash(texto);
  const porHash = await prisma.reporte.findUnique({ where: { hash } });
  if (porHash) return true;

  // R5: verificar también por URL — evita duplicados cuando dos personas
  // comparten el mismo link en WhatsApp con texto distinto (mismo artículo).
  if (urlNoticia) {
    const porUrl = await prisma.reporte.findFirst({ where: { urlNoticia } });
    if (porUrl) return true;
  }

  return false;
}

export async function registrarReporte(texto: string, datos: Record<string, unknown>): Promise<number> {
  const hash = generarHash(texto);

  const reporte = await prisma.reporte.create({
    data: {
      hash,
      fuente: (datos.fuente as string) || 'desconocida',
      fecha: (datos.fecha as string) || new Date().toISOString().split('T')[0],
      hora: (datos.hora as string) || null,
      ubicacion: (datos.ubicacion as string) || 'desconocida',
      ruta: (datos.ruta as string) || 'no especificada',
      tipoIncidente: (datos.tipoIncidente as string) || 'desconocido',
      gravedad: (datos.gravedad as string) || null,
      descripcion: (datos.descripcion as string) || '',
      vehiculo: (datos.vehiculo as string) || null,
      patente: (datos.patente as string) || null,
      textoOriginal: texto,
      urlNoticia: (datos.urlNoticia as string) || null,
      victimas: (datos.victimas as string) || null,
      detenidos: (datos.detenidos as string) || null,
      framerEnviado: false,
      framerIntentos: 0,
      portalOrigen: (datos.portalOrigen as string) || null,
    },
  });

  logger.info(`[Dedup] Reporte registrado (hash: ${hash.substring(0, 12)}...)`);
  return reporte.id;
}

export async function marcarFramerEnviado(id: number): Promise<void> {
  await prisma.reporte.update({
    where: { id },
    data: { framerEnviado: true },
  });
}

export async function incrementarIntentosFramer(id: number): Promise<void> {
  await prisma.reporte.update({
    where: { id },
    data: { framerIntentos: { increment: 1 } },
  });
}

// Reportes que aún no se sincronizaron con Framer (errores transitorios).
// El cron de reintentos los procesa con backoff exponencial.
//
// Modo full-auto (2026-05-05+): incluimos los que quedaron en 'pendiente'
// porque el primer intento de Framer falló. El cron retry los reintenta y
// si tienen éxito los transiciona a 'aprobado' vía aprobarPorIA().
//
// También incluimos 'aprobado' por compatibilidad con el modo manual antiguo.
// Los 'descartado' nunca se envían.
export async function obtenerPendientesFramer() {
  return prisma.reporte.findMany({
    where: {
      estado: { in: ['pendiente', 'aprobado'] },
      framerEnviado: false,
      framerIntentos: { lt: 5 },
    },
    orderBy: { creadoEn: 'asc' },
    take: 20,
  });
}
