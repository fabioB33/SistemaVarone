import logger from './logger';
import crypto from 'crypto';
import prisma from './prisma';
import { resolverCamposFramer } from './enum-matcher';

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

  // Sprint pivot-framer-form (2026-06-26):
  // Aplica fuzzy match a los 10 campos del formulario Framer. Si el matcher
  // no resuelve alguno, queda null y se agrega a `camposFaltantes`. Si la
  // lista tiene >0 entries, el reporte arranca en `pendiente_revision` y
  // Varone tiene que completarlo manualmente desde el dashboard antes de
  // que se publique en pirateriadecamiones.com.ar/formulario-de-incidentes.
  const framer = resolverCamposFramer({
    provincia: datos.provincia as string | null | undefined,
    tipoIncidenteFramer: datos.tipoIncidenteFramer as string | null | undefined,
    fuerzaInterviniente: datos.fuerzaInterviniente as string | null | undefined,
    tipoVehiculo: datos.tipoVehiculo as string | null | undefined,
    cargaTransportada: datos.cargaTransportada as string | null | undefined,
    modusOperandi: datos.modusOperandi as string | null | undefined,
    huboViolencia: datos.huboViolencia as string | null | undefined,
    tipoVehiculoInvolucrado: datos.tipoVehiculoInvolucrado as string | null | undefined,
    cantidadVehiculosInvolucrados: datos.cantidadVehiculosInvolucrados as string | null | undefined,
    cantidadPersonasInvolucradas: datos.cantidadPersonasInvolucradas as string | null | undefined,
  });

  const estado = framer.camposFaltantes.length > 0 ? 'pendiente_revision' : 'pendiente';

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

      // Campos del form Framer
      provincia: framer.provincia,
      tipoIncidenteFramer: framer.tipoIncidenteFramer,
      fuerzaInterviniente: framer.fuerzaInterviniente,
      tipoVehiculo: framer.tipoVehiculo,
      cargaTransportada: framer.cargaTransportada,
      modusOperandi: framer.modusOperandi,
      huboViolencia: framer.huboViolencia,
      tipoVehiculoInvolucrado: framer.tipoVehiculoInvolucrado,
      cantidadVehiculosInvolucrados: framer.cantidadVehiculosInvolucrados,
      cantidadPersonasInvolucradas: framer.cantidadPersonasInvolucradas,
      camposFaltantes: framer.camposFaltantes,
      estado,
    },
  });

  logger.info(
    `[Dedup] Reporte registrado (id=${reporte.id} estado=${estado} faltantes=${framer.camposFaltantes.length})`,
  );
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
