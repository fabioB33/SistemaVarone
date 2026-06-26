/**
 * Sprint pivot-framer-form (2026-06-26) — Server framer-publisher v2.
 *
 * Reemplaza el endpoint v1 que hablaba con Framer Server API.
 * Ahora postea al formulario público con Playwright.
 *
 * Endpoints:
 *  POST /noticia            postea 1 reporte al formulario
 *  GET  /health             healthcheck del browser + sesión
 *
 * Auth: header X-Publisher-Token debe matchear FRAMER_PUBLISHER_TOKEN.
 */

import express, { Request, Response, NextFunction } from 'express';
import { postearReporte, healthcheck, disconnectBrowser } from './form-filler.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const SHARED_TOKEN = process.env.FRAMER_PUBLISHER_TOKEN || '';

function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!SHARED_TOKEN) {
    next();
    return;
  }
  const got = (req.headers['x-publisher-token'] as string) || '';
  if (got !== SHARED_TOKEN) {
    res.status(401).json({ ok: false, error: 'Token inválido.' });
    return;
  }
  next();
}

interface NoticiaBody {
  nombreYApellido?: string;
  fechaIncidente?: string;
  horaIncidente?: string | null;
  provincia?: string;
  direccionLocalidad?: string;
  tipoIncidenteFramer?: string;
  fuerzaInterviniente?: string;
  tipoVehiculo?: string;
  cargaTransportada?: string;
  modusOperandi?: string;
  huboViolencia?: string;
  tipoVehiculoInvolucrado?: string;
  cantidadVehiculosInvolucrados?: string;
  cantidadPersonasInvolucradas?: string;
  descripcionDelHecho?: string | null;
}

app.post('/noticia', requireToken, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as NoticiaBody;

  // Validar campos obligatorios
  const obligatorios: Array<keyof NoticiaBody> = [
    'nombreYApellido',
    'fechaIncidente',
    'provincia',
    'direccionLocalidad',
    'tipoIncidenteFramer',
    'fuerzaInterviniente',
    'tipoVehiculo',
    'cargaTransportada',
    'modusOperandi',
    'huboViolencia',
    'tipoVehiculoInvolucrado',
    'cantidadVehiculosInvolucrados',
    'cantidadPersonasInvolucradas',
  ];
  const faltantes = obligatorios.filter((k) => !body[k]);
  if (faltantes.length > 0) {
    res.status(400).json({
      ok: false,
      error: 'Faltan campos obligatorios.',
      faltantes,
    });
    return;
  }

  try {
    const result = await postearReporte({
      nombreYApellido: body.nombreYApellido!,
      fechaIncidente: body.fechaIncidente!,
      horaIncidente: body.horaIncidente ?? null,
      provincia: body.provincia!,
      direccionLocalidad: body.direccionLocalidad!,
      tipoIncidenteFramer: body.tipoIncidenteFramer!,
      fuerzaInterviniente: body.fuerzaInterviniente!,
      tipoVehiculo: body.tipoVehiculo!,
      cargaTransportada: body.cargaTransportada!,
      modusOperandi: body.modusOperandi!,
      huboViolencia: body.huboViolencia!,
      tipoVehiculoInvolucrado: body.tipoVehiculoInvolucrado!,
      cantidadVehiculosInvolucrados: body.cantidadVehiculosInvolucrados!,
      cantidadPersonasInvolucradas: body.cantidadPersonasInvolucradas!,
      descripcionDelHecho: body.descripcionDelHecho ?? null,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get('/health', requireToken, async (_req: Request, res: Response) => {
  try {
    const h = await healthcheck();
    res.json(h);
  } catch (err) {
    res.status(500).json({
      alive: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

const port = parseInt(process.env.PORT || '4001', 10);
const server = app.listen(port, () => {
  console.log(`[framer-publisher v2] escuchando en http://127.0.0.1:${port}`);
  console.log(`  Sitio destino: https://pirateriadecamiones.com.ar/formulario-de-incidentes`);
  console.log(`  Token auth: ${SHARED_TOKEN ? 'configurado' : 'NO configurado (modo abierto)'}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[framer-publisher v2] señal ${signal}, cerrando...`);
  server.close();
  await disconnectBrowser();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
