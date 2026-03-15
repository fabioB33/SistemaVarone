import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function generarHash(texto: string): string {
  // Normalizar: minúsculas, sin espacios dobles, sin saltos de línea
  const normalizado = texto.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalizado).digest('hex');
}

export async function existeDuplicado(texto: string): Promise<boolean> {
  const hash = generarHash(texto);

  const existente = await prisma.reporte.findUnique({
    where: { hash },
  });

  return existente !== null;
}

export async function registrarReporte(texto: string, datos: Record<string, unknown>): Promise<void> {
  const hash = generarHash(texto);

  await prisma.reporte.create({
    data: {
      hash,
      fuente: (datos.fuente as string) || 'desconocida',
      fecha: (datos.fecha as string) || new Date().toISOString().split('T')[0],
      ubicacion: (datos.ubicacion as string) || 'desconocida',
      ruta: (datos.ruta as string) || 'no especificada',
      tipoIncidente: (datos.tipoIncidente as string) || 'desconocido',
      descripcion: (datos.descripcion as string) || '',
      textoOriginal: texto,
      urlNoticia: (datos.urlNoticia as string) || null,
    },
  });

  console.log(`[Dedup] Reporte registrado (hash: ${hash.substring(0, 12)}...)`);
}
