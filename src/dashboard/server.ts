import express from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { ENV } from '../config/env';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import prisma from '../services/prisma';
import { notificar } from '../services/notificaciones';

// Sesiones activas (token → timestamp de expiración)
const activeSessions = new Map<string, number>();
const SESSION_DURATION = 4 * 60 * 60 * 1000; // 4 horas

// Limpiar tokens expirados cada hora para no acumular en memoria
setInterval(() => {
  const ahora = Date.now();
  for (const [token, expires] of activeSessions) {
    if (ahora >= expires) activeSessions.delete(token);
  }
}, 60 * 60 * 1000);

// Estado compartido del QR y WhatsApp
let qrData: string | null = null;
let waStatus: 'disconnected' | 'qr' | 'connected' = 'disconnected';

// SSE — clientes suscritos al feed en tiempo real del grupo
type SseClient = { res: import('express').Response; id: number };
let sseClientId = 0;
const sseClients = new Map<number, SseClient>();

export interface MensajeGrupo {
  id: string;
  from: string;
  fromName: string;
  body: string;
  timestamp: number;
  type: string;    // 'chat' | 'image' | 'audio' | etc.
  procesado?: boolean | null;  // null = en proceso, true = fue reporte, false = descartado
}

// Historial en memoria de los últimos 50 mensajes para hacer backfill al conectar
const HISTORIAL_MAX = 50;
const historialMensajes: MensajeGrupo[] = [];

/**
 * Emite un evento SSE tipado a todos los clientes conectados.
 */
function emitirSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients.values()) {
    client.res.write(payload);
  }
}

/**
 * Emite un mensaje del grupo a todos los clientes SSE conectados.
 * Llamado desde el agente de WhatsApp cada vez que llega un mensaje.
 */
export function emitirMensajeGrupo(msg: MensajeGrupo): void {
  // Guardar en historial para backfill de nuevos clientes
  historialMensajes.push(msg);
  if (historialMensajes.length > HISTORIAL_MAX) historialMensajes.shift();
  emitirSSE('mensaje', msg);
}

/**
 * Actualiza el estado de procesamiento de un mensaje ya emitido.
 * Llamado desde el pipeline cuando termina de analizar el texto.
 */
export function emitirEstadoProcesado(msgId: string, fueReporte: boolean, meta?: { gravedad?: string; ubicacion?: string }): void {
  emitirSSE('procesado', { id: msgId, fueReporte, ...meta });
}

/**
 * Emite el QR actual a todos los clientes SSE conectados.
 * Llamado inmediatamente cuando whatsapp-web.js genera un nuevo QR.
 */
export async function emitirQR(qr: string): Promise<void> {
  qrData = qr;
  waStatus = 'qr';
  const qrImage = await QRCode.toDataURL(qr, { width: 300 }).catch(() => null);
  if (qrImage) emitirSSE('qr', { qr: qrImage });
}

/**
 * Emite cambio de estado de WhatsApp (connected / disconnected) via SSE.
 */
export function emitirEstadoWA(status: 'connected' | 'disconnected'): void {
  emitirSSE('wa_status', { status });
}

// Contadores de pipeline en memoria (se resetean al reiniciar el proceso)
const pipelineMetrics = {
  textosTotales: 0,
  duplicadosDescartados: 0,
  noRelevantesDescartados: 0,
  reportesRegistrados: 0,
  framerEnviados: 0,
  framerFallidos: 0,
  iniciadoEn: new Date(),
};

export function incrementarMetrica(metrica: keyof Omit<typeof pipelineMetrics, 'iniciadoEn'>) {
  pipelineMetrics[metrica]++;
}

// Funciones para actualizar estado desde whatsapp.ts
export function setQrData(qr: string) {
  // emitirQR ya actualiza qrData y waStatus, y hace push via SSE
  emitirQR(qr).catch(err => console.error('[Dashboard] Error emitiendo QR via SSE:', err));
}
export function setWaConnected() {
  waStatus = 'connected';
  qrData = null;
  emitirEstadoWA('connected');
}
export function setWaDisconnected() {
  waStatus = 'disconnected';
  qrData = null;
  emitirEstadoWA('disconnected');
}


// Notifica desconexión de WhatsApp via WhatsApp directo a Varone
export async function notificarDesconexion(reason: string): Promise<void> {
  console.error(`[ALERTA] WhatsApp desconectado: ${reason} — ${new Date().toLocaleString('es-AR')}`);
  const msg = `🚨 *Sistema Varone*\nWhatsApp desconectado\nMotivo: ${reason}\nHora: ${new Date().toLocaleString('es-AR')}\n\nReconexión automática en progreso.`;
  await notificar(msg);
}

export function startDashboard(port: number = 3000) {
  const app = express();

  app.use(express.json());

  // Endpoint de login — devuelve token
  app.post('/api/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === ENV.DASHBOARD_USER && pass === ENV.DASHBOARD_PASS) {
      const token = crypto.randomBytes(32).toString('hex');
      activeSessions.set(token, Date.now() + SESSION_DURATION);
      res.json({ ok: true, token });
    } else {
      res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }
  });

  // Pantalla de login (accesible sin auth)
  app.get('/login', (_req, res) => {
    res.send(LOGIN_HTML);
  });

  // Dashboard HTML (auth se verifica client-side con token en localStorage)
  app.get('/', (_req, res) => {
    res.send(DASHBOARD_HTML);
  });

  // Auth middleware — protege solo las APIs
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/') || req.path === '/api/login') return next();

    // Bypass server-to-server (varone-admin → backend) vía X-Backend-Token.
    // Comparación timing-safe para evitar leaks por timing.
    const backendToken = req.headers['x-backend-token'];
    if (
      ENV.BACKEND_API_TOKEN &&
      typeof backendToken === 'string' &&
      backendToken.length === ENV.BACKEND_API_TOKEN.length
    ) {
      const a = Buffer.from(backendToken);
      const b = Buffer.from(ENV.BACKEND_API_TOKEN);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    }

    // Auth tradicional por sesión (login web del propio dashboard).
    const token = req.headers.authorization?.replace('Bearer ', '') ||
                  req.query.token as string;
    if (token && activeSessions.has(token)) {
      const expires = activeSessions.get(token) ?? 0;
      if (Date.now() < expires) return next();
      activeSessions.delete(token);
    }
    res.status(401).json({ error: 'No autorizado' });
  });

  // API: SSE — feed en tiempo real de mensajes del grupo de WhatsApp
  app.get('/api/mensajes/stream', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string;
    if (!token || !activeSessions.has(token) || Date.now() >= (activeSessions.get(token) ?? 0)) {
      res.status(401).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Enviar estado inicial: wa_status + nombre del grupo + QR si está pendiente
    res.write(`event: init\ndata: ${JSON.stringify({
      waStatus,
      grupoNombre: ENV.WA_GROUP_NAME,
    })}\n\n`);

    // Backfill: enviar historial de mensajes recientes para que el panel no arranque vacío
    for (const msg of historialMensajes) {
      res.write(`event: mensaje\ndata: ${JSON.stringify(msg)}\n\n`);
    }

    // Si hay QR pendiente, enviarlo inmediatamente al nuevo cliente
    if (waStatus === 'qr' && qrData) {
      QRCode.toDataURL(qrData, { width: 300 })
        .then(qrImage => res.write(`event: qr\ndata: ${JSON.stringify({ qr: qrImage })}\n\n`))
        .catch(() => {});
    }

    const id = ++sseClientId;
    sseClients.set(id, { res, id });

    // Heartbeat cada 30s para mantener la conexión viva
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(id);
    });
  });

  // API: métricas del pipeline en tiempo real
  app.get('/api/metrics', (_req, res) => {
    const uptimeMs = Date.now() - pipelineMetrics.iniciadoEn.getTime();
    const uptimeHs = Math.floor(uptimeMs / 3600000);
    const uptimeMin = Math.floor((uptimeMs % 3600000) / 60000);
    res.json({
      ...pipelineMetrics,
      iniciadoEn: pipelineMetrics.iniciadoEn.toISOString(),
      uptime: `${uptimeHs}h ${uptimeMin}m`,
      tasaConversion: pipelineMetrics.textosTotales > 0
        ? `${((pipelineMetrics.reportesRegistrados / pipelineMetrics.textosTotales) * 100).toFixed(1)}%`
        : '0%',
    });
  });

  // API: reportes
  app.get('/api/reportes', async (req, res) => {
    const { fuente, gravedad, busqueda, desde, hasta, tipo } = req.query;
    const where: Record<string, unknown> = {};

    if (fuente && fuente !== 'todos') where.fuente = fuente;
    if (gravedad && gravedad !== 'todos') where.gravedad = gravedad;
    if (tipo && tipo !== 'todos') where.tipoIncidente = tipo;

    // Filtro por rango de fechas
    if (desde || hasta) {
      where.creadoEn = {
        ...(desde ? { gte: new Date(String(desde)) } : {}),
        ...(hasta ? { lte: new Date(String(hasta) + 'T23:59:59') } : {}),
      };
    }

    if (busqueda) {
      where.OR = [
        { ubicacion: { contains: String(busqueda), mode: 'insensitive' } },
        { ruta: { contains: String(busqueda), mode: 'insensitive' } },
        { descripcion: { contains: String(busqueda), mode: 'insensitive' } },
        { tipoIncidente: { contains: String(busqueda), mode: 'insensitive' } },
      ];
    }

    // D2: paginación para evitar devolver miles de registros de una vez
    const pagina = Math.max(1, parseInt(String(req.query.pagina ?? '1'), 10));
    const porPagina = Math.min(100, Math.max(1, parseInt(String(req.query.porPagina ?? '50'), 10)));
    const skip = (pagina - 1) * porPagina;

    const [reportes, total] = await Promise.all([
      prisma.reporte.findMany({ where, orderBy: { creadoEn: 'desc' }, skip, take: porPagina }),
      prisma.reporte.count({ where }),
    ]);
    res.json({ reportes, total, pagina, porPagina, totalPaginas: Math.ceil(total / porPagina) });
  });

  // API: stats
  app.get('/api/stats', async (_req, res) => {
    const total = await prisma.reporte.count();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const hoyCount = await prisma.reporte.count({ where: { creadoEn: { gte: hoy } } });
    const porTipo = await prisma.$queryRawUnsafe<Array<{ tipo_incidente: string; count: bigint }>>(
      `SELECT tipo_incidente, COUNT(*) as count FROM reportes GROUP BY tipo_incidente ORDER BY count DESC`
    );
    const porFuente = await prisma.$queryRawUnsafe<Array<{ fuente: string; count: bigint }>>(
      `SELECT fuente, COUNT(*) as count FROM reportes GROUP BY fuente ORDER BY count DESC`
    );
    const porGravedad = await prisma.$queryRawUnsafe<Array<{ gravedad: string; count: bigint }>>(
      `SELECT gravedad, COUNT(*) as count FROM reportes WHERE gravedad IS NOT NULL GROUP BY gravedad ORDER BY count DESC`
    );
    const pendientesFramer = await prisma.reporte.count({
      where: { framerEnviado: false, framerIntentos: { lt: 5 } },
    });
    res.json({
      total,
      hoy: hoyCount,
      pendientesFramer,
      porTipo: porTipo.map(r => ({ tipo: r.tipo_incidente, count: Number(r.count) })),
      porFuente: porFuente.map(r => ({ fuente: r.fuente, count: Number(r.count) })),
      porGravedad: porGravedad.map(r => ({ gravedad: r.gravedad, count: Number(r.count) })),
      waStatus,
    });
  });

  // API: reintentar Framer manualmente desde el dashboard
  app.post('/api/framer/reintentar', async (_req, res) => {
    try {
      const { reintentarFramerPendientes } = await import('../services/pipeline');
      await reintentarFramerPendientes();
      const pendientes = await prisma.reporte.count({ where: { framerEnviado: false, framerIntentos: { lt: 5 } } });
      res.json({ ok: true, pendientesRestantes: pendientes });
    } catch (error) {
      console.error('[Dashboard] Error en reintento manual Framer:', error);
      res.status(500).json({ ok: false, error: 'Error al reintentar' });
    }
  });

  // ─── Flujo de aprobación humana (Framer Server API) ───────────────────────

  // API: listar reportes por estado (default: pendientes)
  app.get('/api/aprobacion/lista', async (req, res) => {
    try {
      const estado = String(req.query.estado || 'pendiente') as
        | 'pendiente' | 'aprobado' | 'publicado' | 'descartado';
      const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
      const { listarPorEstado } = await import('../services/aprobacion');
      const items = await listarPorEstado(estado, limit);
      res.json({ ok: true, estado, items });
    } catch (error) {
      console.error('[Dashboard] Error listando reportes por estado:', error);
      res.status(500).json({ ok: false, error: 'Error al listar' });
    }
  });

  // API: aprobar reporte → envía a Framer (draft)
  app.post('/api/aprobacion/aprobar', async (req, res) => {
    try {
      const id = parseInt(String(req.body?.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: 'id inválido' });
        return;
      }
      const aprobadoPor = String(req.body?.aprobadoPor || ENV.DASHBOARD_USER || 'dashboard');
      const { aprobar } = await import('../services/aprobacion');
      const result = await aprobar(id, aprobadoPor);
      res.json(result);
    } catch (error) {
      console.error('[Dashboard] Error aprobando reporte:', error);
      res.status(500).json({ ok: false, error: 'Error al aprobar' });
    }
  });

  // API: editar un reporte pendiente antes de aprobarlo
  app.post('/api/aprobacion/editar', async (req, res) => {
    try {
      const id = parseInt(String(req.body?.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: 'id inválido' });
        return;
      }
      const editorPor = String(req.body?.editorPor || ENV.DASHBOARD_USER || 'dashboard');
      const cambios = (req.body?.cambios && typeof req.body.cambios === 'object')
        ? req.body.cambios
        : {};
      const { editarPendiente } = await import('../services/aprobacion');
      const result = await editarPendiente(id, cambios, editorPor);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      console.error('[Dashboard] Error editando reporte:', error);
      res.status(500).json({ ok: false, error: 'Error al editar' });
    }
  });

  // API: descartar reporte → nunca llega a Framer
  app.post('/api/aprobacion/descartar', async (req, res) => {
    try {
      const id = parseInt(String(req.body?.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: 'id inválido' });
        return;
      }
      const descartadoPor = String(req.body?.descartadoPor || ENV.DASHBOARD_USER || 'dashboard');
      const { descartar } = await import('../services/aprobacion');
      const result = await descartar(id, descartadoPor);
      res.json(result);
    } catch (error) {
      console.error('[Dashboard] Error descartando reporte:', error);
      res.status(500).json({ ok: false, error: 'Error al descartar' });
    }
  });

  // API: publicar el sitio AHORA (botón manual en dashboard).
  // Cron diario también lo dispara automáticamente.
  app.post('/api/framer/publicar', async (_req, res) => {
    try {
      const { publicarSitio } = await import('../services/framer');
      const { marcarPublicadosTrasPublish } = await import('../services/aprobacion');
      const result = await publicarSitio();
      if (!result) {
        res.status(500).json({ ok: false, error: 'Falló publicación del sitio' });
        return;
      }
      const promovidos = await marcarPublicadosTrasPublish();
      res.json({ ok: true, deploymentId: result.deploymentId, promovidos });
    } catch (error) {
      console.error('[Dashboard] Error publicando sitio:', error);
      res.status(500).json({ ok: false, error: 'Error al publicar' });
    }
  });

  // API: QR como imagen
  app.get('/api/qr', async (_req, res) => {
    if (!qrData) {
      res.json({ status: waStatus, qr: null });
      return;
    }
    const qrImage = await QRCode.toDataURL(qrData, { width: 300 });
    res.json({ status: waStatus, qr: qrImage });
  });

  // API: estado consolidado de WhatsApp para varone-admin.
  // Combina status, QR (si aplica), nombre del grupo y métricas básicas.
  app.get('/api/wa/status', async (_req, res) => {
    const qr = qrData ? await QRCode.toDataURL(qrData, { width: 300 }) : null;
    const pendientesCount = await prisma.reporte.count({ where: { estado: 'pendiente' } }).catch(() => 0);
    const ultimoReporte = await prisma.reporte.findFirst({
      orderBy: { creadoEn: 'desc' },
      select: { creadoEn: true },
    }).catch(() => null);
    res.json({
      status: waStatus,
      qr,
      groupName: ENV.WA_GROUP_NAME || null,
      pendientes: pendientesCount,
      ultimoReporteEn: ultimoReporte?.creadoEn ?? null,
      ahora: new Date().toISOString(),
    });
  });

  // API: exportar CSV
  app.get('/api/exportar', async (req, res) => {
    const { fuente, gravedad, busqueda } = req.query;
    const where: Record<string, unknown> = {};
    if (fuente && fuente !== 'todos') where.fuente = fuente;
    if (gravedad && gravedad !== 'todos') where.gravedad = gravedad;
    if (busqueda) {
      where.OR = [
        { ubicacion: { contains: String(busqueda), mode: 'insensitive' } },
        { ruta: { contains: String(busqueda), mode: 'insensitive' } },
        { descripcion: { contains: String(busqueda), mode: 'insensitive' } },
        { tipoIncidente: { contains: String(busqueda), mode: 'insensitive' } },
      ];
    }
    const reportes = await prisma.reporte.findMany({ where, orderBy: { creadoEn: 'desc' } });

    const header = 'Fecha,Hora incidente,Ubicación,Ruta,Tipo,Gravedad,Vehículo,Patente,Fuente,Descripción,Víctimas,Detenidos,URL\n';
    const rows = reportes.map(r => {
      const esc = (s: string | null | undefined) => s ? '"' + s.replace(/"/g, '""') + '"' : '';
      return [
        r.fecha,
        r.hora || '',
        esc(r.ubicacion),
        esc(r.ruta),
        esc(r.tipoIncidente),
        r.gravedad || '',
        esc(r.vehiculo),
        r.patente || '',
        r.fuente,
        esc(r.descripcion),
        esc(r.victimas),
        esc(r.detenidos),
        r.urlNoticia || '',
      ].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reportes-varone-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send('\uFEFF' + header + rows);
  });

  // API: resumen diario generado con IA (persiste en DB para sobrevivir reinicios)
  let resumenCache: { texto: string; generadoEn: number; reportesContados: number } | null = null;
  let resumenEnProgreso = false;
  const RESUMEN_TTL = 10 * 60 * 1000; // 10 minutos de cache en memoria

  app.get('/api/resumen-diario', async (_req, res) => {
    try {
      const fechaHoy = new Date().toISOString().split('T')[0];
      const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
      const reportesHoy = await prisma.reporte.count({ where: { creadoEn: { gte: inicioDia } } });

      // 1. Servir desde cache si es reciente Y no llegaron reportes nuevos desde que se generó
      if (resumenCache &&
          (Date.now() - resumenCache.generadoEn) < RESUMEN_TTL &&
          resumenCache.reportesContados >= reportesHoy) {
        res.json({ resumen: resumenCache.texto, cached: true });
        return;
      }

      // 2. Buscar en DB solo si no hay reportes nuevos desde la última generación
      const resumenDB = await prisma.resumenDiario.findUnique({ where: { fecha: fechaHoy } });
      if (resumenDB && resumenCache && resumenCache.reportesContados >= reportesHoy) {
        resumenCache = { texto: resumenDB.texto, generadoEn: Date.now(), reportesContados: reportesHoy };
        res.json({ resumen: resumenDB.texto, cached: true });
        return;
      }

      // 3. Evitar llamadas concurrentes a la IA
      if (resumenEnProgreso) {
        res.json({ resumen: 'Generando resumen, intentá en unos segundos.', cached: false });
        return;
      }
      resumenEnProgreso = true;

      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const ayer = new Date(hoy);
      ayer.setDate(ayer.getDate() - 1);

      let reportes = await prisma.reporte.findMany({
        where: { creadoEn: { gte: hoy } },
        orderBy: { creadoEn: 'desc' },
      });

      let periodoLabel = 'hoy';
      if (reportes.length < 3) {
        reportes = await prisma.reporte.findMany({
          where: { creadoEn: { gte: ayer } },
          orderBy: { creadoEn: 'desc' },
        });
        periodoLabel = 'las últimas 24 horas';
      }

      if (reportes.length === 0) {
        resumenEnProgreso = false;
        res.json({ resumen: 'No se registraron incidentes en ' + periodoLabel + '.', cached: false });
        return;
      }

      const datosParaIA = reportes.map(r => ({
        tipo: r.tipoIncidente,
        gravedad: r.gravedad,
        ubicacion: r.ubicacion,
        ruta: r.ruta,
        descripcion: r.descripcion,
        fuente: r.fuente,
      }));

      const prompt = `Sos un analista de seguridad vial en Argentina. Generá un resumen ejecutivo BREVE (máximo 3 oraciones) de los siguientes ${reportes.length} incidentes registrados en ${periodoLabel}. Mencioná las zonas más afectadas, tipos de incidentes predominantes y nivel de gravedad general. Sé directo y profesional. No uses markdown ni viñetas, solo texto corrido.\n\nIncidentes:\n${JSON.stringify(datosParaIA)}`;

      let resumenTexto: string;

      if (ENV.AI_PROVIDER === 'gemini') {
        const genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        resumenTexto = result.response.text().trim();
      } else {
        const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
        const result = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
        });
        resumenTexto = result.choices[0]?.message?.content?.trim() || 'No se pudo generar el resumen.';
      }

      // Persistir en DB (upsert por si ya existe de una carrera)
      await prisma.resumenDiario.upsert({
        where: { fecha: fechaHoy },
        update: { texto: resumenTexto },
        create: { fecha: fechaHoy, texto: resumenTexto },
      });

      resumenCache = { texto: resumenTexto, generadoEn: Date.now(), reportesContados: reportesHoy };
      resumenEnProgreso = false;
      res.json({ resumen: resumenTexto, cached: false });
    } catch (error) {
      resumenEnProgreso = false;
      console.error('[Dashboard] Error generando resumen diario:', error);
      res.json({ resumen: 'Error al generar resumen. Los reportes individuales están disponibles debajo.', cached: false });
    }
  });

  app.listen(port, () => {
    console.log(`[Dashboard] Disponible en http://localhost:${port}`);
  });
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sistema Varone - Acceso</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-wrapper { width: 100%; max-width: 420px; padding: 20px; }
    .login-card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px 36px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    .login-logo { text-align: center; margin-bottom: 32px; }
    .login-logo .shield { font-size: 48px; margin-bottom: 12px; display: block; }
    .login-logo h1 { font-size: 22px; font-weight: 700; color: #f1f5f9; letter-spacing: -0.5px; }
    .login-logo .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
    .login-logo .badge { display: inline-block; background: #ef44441a; color: #f87171; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 1px; margin-top: 8px; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .form-group input { width: 100%; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; font-size: 15px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
    .form-group input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px #3b82f620; }
    .form-group input::placeholder { color: #475569; }
    .login-btn { width: 100%; background: #3b82f6; color: white; border: none; padding: 12px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s, transform 0.1s; }
    .login-btn:hover { background: #2563eb; }
    .login-btn:active { transform: scale(0.98); }
    .login-btn:disabled { background: #475569; cursor: not-allowed; }
    .error-msg { background: #ef44441a; border: 1px solid #ef444440; color: #f87171; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; display: none; text-align: center; }
    .login-footer { text-align: center; margin-top: 24px; font-size: 11px; color: #475569; }
    .login-footer .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; margin-right: 6px; animation: dot-pulse 2s infinite; }
    @keyframes dot-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    .bg-grid { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-image: radial-gradient(#1e293b 1px, transparent 1px); background-size: 40px 40px; pointer-events: none; opacity: 0.4; z-index: -1; }
  </style>
</head>
<body>
  <div class="bg-grid"></div>
  <div class="login-wrapper">
    <div class="login-card">
      <div class="login-logo">
        <span class="shield">&#x1F6E1;</span>
        <h1>Sistema Varone</h1>
        <div class="subtitle">Monitor de Seguridad Vial</div>
        <span class="badge">ACCESO RESTRINGIDO</span>
      </div>
      <div class="error-msg" id="error-msg">Usuario o clave incorrectos</div>
      <form id="login-form" onsubmit="doLogin(event)">
        <div class="form-group">
          <label>Usuario</label>
          <input type="text" id="login-user" placeholder="Ingrese su usuario" autocomplete="username" required autofocus />
        </div>
        <div class="form-group">
          <label>Clave de acceso</label>
          <input type="password" id="login-pass" placeholder="Ingrese su clave" autocomplete="current-password" required />
        </div>
        <button type="submit" class="login-btn" id="login-btn">Ingresar al sistema</button>
      </form>
      <div class="login-footer"><span class="dot"></span>Sistema operativo 24/7</div>
    </div>
  </div>
  <script>
    async function doLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      const errEl = document.getElementById('error-msg');
      btn.disabled = true;
      btn.textContent = 'Verificando...';
      errEl.style.display = 'none';
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: document.getElementById('login-user').value,
            pass: document.getElementById('login-pass').value
          })
        });
        const data = await res.json();
        if (data.ok) {
          localStorage.setItem('varone_token', data.token);
          window.location.href = '/';
        } else {
          errEl.textContent = data.error || 'Credenciales incorrectas';
          errEl.style.display = 'block';
          document.getElementById('login-pass').value = '';
          document.getElementById('login-pass').focus();
        }
      } catch(err) {
        errEl.textContent = 'Error de conexión. Intente de nuevo.';
        errEl.style.display = 'block';
      }
      btn.disabled = false;
      btn.textContent = 'Ingresar al sistema';
    }
  </script>
</body>
</html>`;


const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sistema Varone - Monitor en Vivo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }

    /* Layout */
    .app { display: grid; grid-template-columns: 1fr 420px; grid-template-rows: 56px 1fr; height: 100vh; }
    .topbar { grid-column: 1 / -1; background: #1e293b; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; }
    .topbar-left { display: flex; align-items: center; gap: 12px; }
    .topbar h1 { font-size: 15px; font-weight: 700; color: #f1f5f9; letter-spacing: -0.3px; }
    .topbar-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.8px; text-transform: uppercase; }
    .badge-live { background: #22c55e20; color: #4ade80; border: 1px solid #22c55e40; }
    .badge-warn { background: #f59e0b20; color: #fbbf24; border: 1px solid #f59e0b40; }
    .badge-off  { background: #64748b20; color: #94a3b8; border: 1px solid #64748b40; }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .stat-pill { font-size: 12px; color: #64748b; }
    .stat-pill span { color: #e2e8f0; font-weight: 600; }
    .logout-btn { background: none; border: 1px solid #334155; color: #94a3b8; padding: 5px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .logout-btn:hover { border-color: #ef4444; color: #f87171; }

    /* Panel izquierdo: reportes */
    .panel-reportes { overflow-y: auto; background: #0f172a; }
    .panel-header { padding: 20px 24px 12px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; background: #0f172a; z-index: 10; border-bottom: 1px solid #1e293b; }
    .panel-header h2 { font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.8px; }
    .filtros { display: flex; gap: 8px; padding: 12px 24px; background: #0f172a; position: sticky; top: 53px; z-index: 9; border-bottom: 1px solid #1e293b; }
    .filtro-select { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 5px 10px; border-radius: 6px; font-size: 12px; outline: none; }
    .busqueda-input { flex: 1; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 5px 10px; border-radius: 6px; font-size: 12px; outline: none; }
    .busqueda-input:focus { border-color: #3b82f6; }
    .resumen-box { margin: 16px 24px; background: #1e293b; border: 1px solid #3b82f640; border-radius: 10px; padding: 14px 16px; }
    .resumen-box .resumen-label { font-size: 10px; font-weight: 700; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
    .resumen-box p { font-size: 13px; color: #cbd5e1; line-height: 1.6; }
    .reportes-list { padding: 0 24px 24px; }
    .reporte-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; transition: border-color 0.2s; }
    .reporte-card:hover { border-color: #475569; }
    .reporte-card.alta { border-left: 3px solid #ef4444; }
    .reporte-card.media { border-left: 3px solid #f59e0b; }
    .reporte-card.baja { border-left: 3px solid #22c55e; }
    .rc-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
    .rc-tipo { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.6px; background: #0f172a; color: #94a3b8; }
    .rc-gravedad { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; }
    .grav-alta { background: #ef44441a; color: #f87171; }
    .grav-media { background: #f59e0b1a; color: #fbbf24; }
    .grav-baja { background: #22c55e1a; color: #4ade80; }
    .rc-ubicacion { font-size: 13px; font-weight: 600; color: #f1f5f9; }
    .rc-ruta { font-size: 11px; color: #64748b; }
    .rc-desc { font-size: 12px; color: #94a3b8; line-height: 1.5; margin-top: 4px; }
    .rc-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; color: #475569; }
    .paginacion { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 16px 0; }
    .pag-btn { background: #1e293b; border: 1px solid #334155; color: #94a3b8; padding: 5px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pag-btn:not(:disabled):hover { border-color: #475569; color: #e2e8f0; }
    .pag-info { font-size: 12px; color: #475569; }

    /* Modal detalle de reporte */
    .modal-overlay { position: fixed; inset: 0; background: #000a; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .modal-card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; }
    .modal-header { padding: 20px 24px 16px; border-bottom: 1px solid #334155; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .modal-header h3 { font-size: 15px; font-weight: 700; color: #f1f5f9; line-height: 1.4; }
    .modal-close { background: none; border: none; color: #64748b; font-size: 20px; cursor: pointer; padding: 0; line-height: 1; flex-shrink: 0; }
    .modal-close:hover { color: #e2e8f0; }
    .modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
    .modal-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .modal-field { flex: 1; min-width: 140px; }
    .modal-label { font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
    .modal-value { font-size: 13px; color: #cbd5e1; }
    .modal-value.mono { font-family: monospace; font-size: 12px; background: #0f172a; padding: 8px 10px; border-radius: 6px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
    .reporte-card { cursor: pointer; }
    .reporte-card:hover { border-color: #3b82f640; background: #1e293bcc; }

    /* Panel derecho: chat en tiempo real */
    .panel-chat { background: #0d1525; border-left: 1px solid #1e293b; display: flex; flex-direction: column; }
    .chat-header { padding: 16px 18px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .chat-header h2 { font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.8px; }
    .chat-conn-dot { width: 7px; height: 7px; border-radius: 50%; background: #475569; flex-shrink: 0; }
    .chat-conn-dot.connected { background: #22c55e; box-shadow: 0 0 6px #22c55e80; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .chat-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
    .chat-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; color: #334155; }
    .chat-empty svg { opacity: 0.3; }
    .chat-empty p { font-size: 13px; }
    .msg-bubble { max-width: 100%; }
    .msg-name { font-size: 10px; font-weight: 700; color: #3b82f6; margin-bottom: 2px; }
    .msg-text { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 8px 10px; font-size: 13px; color: #e2e8f0; line-height: 1.5; word-break: break-word; }
    .msg-text.multimedia { color: #64748b; font-style: italic; }
    .msg-time { font-size: 10px; color: #475569; margin-top: 3px; text-align: right; }
    .msg-new { animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .chat-count { font-size: 11px; color: #475569; padding: 8px 14px; border-top: 1px solid #1e293b; flex-shrink: 0; text-align: center; }

    /* QR modal */
    .qr-overlay { position: fixed; inset: 0; background: #0008; z-index: 100; display: flex; align-items: center; justify-content: center; }
    .qr-card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; text-align: center; max-width: 340px; }
    .qr-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
    .qr-card p { font-size: 13px; color: #64748b; margin-bottom: 20px; }
    .qr-card img { width: 240px; height: 240px; border-radius: 8px; background: #fff; }
    .qr-close { margin-top: 16px; background: none; border: 1px solid #334155; color: #94a3b8; padding: 8px 20px; border-radius: 8px; cursor: pointer; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
  </style>
</head>
<body>
<div class="app" id="app" style="display:none">
  <div class="topbar">
    <div class="topbar-left">
      <span style="font-size:20px">🛡️</span>
      <h1>Sistema Varone</h1>
      <span class="topbar-badge badge-off" id="wa-badge">Conectando...</span>
    </div>
    <div class="topbar-right">
      <div class="stat-pill">Hoy: <span id="stat-hoy">—</span></div>
      <div class="stat-pill">Total: <span id="stat-total">—</span></div>
      <div class="stat-pill">Uptime: <span id="stat-uptime">—</span></div>
      <button class="logout-btn" onclick="logout()">Salir</button>
    </div>
  </div>

  <!-- Panel izquierdo: reportes procesados por IA -->
  <div class="panel-reportes">
    <div class="panel-header">
      <h2>Reportes procesados por IA</h2>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="btn-reintentar" onclick="reintentarFramer()" style="display:none;background:#f59e0b1a;border:1px solid #f59e0b40;color:#fbbf24;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">↻ Reintentar Framer (<span id="pendientes-count">0</span>)</button>
        <button onclick="exportarCSV()" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">⬇ CSV</button>
      </div>
    </div>
    <div class="filtros">
      <select class="filtro-select" id="filtro-tipo" onchange="cargarReportes(1)">
        <option value="todos">Todos los tipos</option>
        <option value="robo_de_carga">Robo de carga</option>
        <option value="asalto">Asalto</option>
        <option value="tentativa">Tentativa</option>
        <option value="bloqueo">Bloqueo</option>
        <option value="alerta">Alerta</option>
        <option value="accidente">Accidente</option>
      </select>
      <select class="filtro-select" id="filtro-gravedad" onchange="cargarReportes(1)">
        <option value="todos">Todas las gravedades</option>
        <option value="alta">Alta</option>
        <option value="media">Media</option>
        <option value="baja">Baja</option>
      </select>
      <input class="busqueda-input" id="filtro-busqueda" placeholder="Buscar ubicación, ruta, descripción..." oninput="debounceSearch()" />
    </div>
    <div class="resumen-box" id="resumen-box" style="display:none">
      <div class="resumen-label">Resumen IA del día</div>
      <p id="resumen-texto">Cargando...</p>
    </div>
    <div class="reportes-list" id="reportes-list"></div>
    <div class="paginacion" id="paginacion" style="display:none">
      <button class="pag-btn" id="pag-prev" onclick="cambiarPagina(-1)">← Anterior</button>
      <span class="pag-info" id="pag-info"></span>
      <button class="pag-btn" id="pag-next" onclick="cambiarPagina(1)">Siguiente →</button>
    </div>
  </div>

  <!-- Panel derecho: chat en tiempo real del grupo -->
  <div class="panel-chat">
    <div class="chat-header">
      <div>
        <h2>💬 Grupo en vivo</h2>
        <div id="chat-grupo-nombre" style="font-size:11px;color:#475569;margin-top:2px;">—</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span id="chat-conn-label" style="font-size:11px;color:#475569;">Sin conexión</span>
        <div class="chat-conn-dot" id="chat-conn-dot"></div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages">
      <div class="chat-empty" id="chat-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>Esperando mensajes del grupo...</p>
      </div>
    </div>
    <div class="chat-count" id="chat-count">0 mensajes recibidos</div>
  </div>
</div>

<!-- QR Modal -->
<div class="qr-overlay" id="qr-overlay" style="display:none">
  <div class="qr-card">
    <h3>Escanear código QR</h3>
    <p>Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
    <img id="qr-img" src="" alt="QR Code" />
    <br><button class="qr-close" onclick="document.getElementById('qr-overlay').style.display='none'">Cerrar</button>
  </div>
</div>

<!-- Modal detalle de reporte -->
<div class="modal-overlay" id="modal-detalle" style="display:none" onclick="if(event.target===this)cerrarModal()">
  <div class="modal-card">
    <div class="modal-header">
      <h3 id="modal-titulo">—</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-row">
        <div class="modal-field"><div class="modal-label">Tipo</div><div class="modal-value" id="modal-tipo">—</div></div>
        <div class="modal-field"><div class="modal-label">Gravedad</div><div class="modal-value" id="modal-gravedad">—</div></div>
        <div class="modal-field"><div class="modal-label">Fecha</div><div class="modal-value" id="modal-fecha">—</div></div>
        <div class="modal-field"><div class="modal-label">Hora</div><div class="modal-value" id="modal-hora">—</div></div>
      </div>
      <div class="modal-row">
        <div class="modal-field"><div class="modal-label">Ubicación</div><div class="modal-value" id="modal-ubicacion">—</div></div>
        <div class="modal-field"><div class="modal-label">Ruta</div><div class="modal-value" id="modal-ruta">—</div></div>
      </div>
      <div class="modal-row">
        <div class="modal-field"><div class="modal-label">Vehículo</div><div class="modal-value" id="modal-vehiculo">—</div></div>
        <div class="modal-field"><div class="modal-label">Patente</div><div class="modal-value" id="modal-patente">—</div></div>
      </div>
      <div class="modal-row">
        <div class="modal-field"><div class="modal-label">Víctimas</div><div class="modal-value" id="modal-victimas">—</div></div>
        <div class="modal-field"><div class="modal-label">Detenidos</div><div class="modal-value" id="modal-detenidos">—</div></div>
      </div>
      <div><div class="modal-label">Descripción</div><div class="modal-value" id="modal-descripcion" style="margin-top:4px;">—</div></div>
      <div id="modal-url-row" style="display:none"><div class="modal-label">URL noticia</div><a class="modal-value" id="modal-url" href="#" target="_blank" style="color:#3b82f6;font-size:12px;word-break:break-all;">—</a></div>
      <div><div class="modal-label">Texto original del grupo</div><div class="modal-value mono" id="modal-original">—</div></div>
    </div>
  </div>
</div>

<script>
  const token = localStorage.getItem('varone_token');
  if (!token) { window.location.href = '/login'; }
  else { document.getElementById('app').style.display = 'grid'; init(); }

  let paginaActual = 1;
  let searchTimer = null;
  let msgCount = 0;
  let autoScroll = true;
  let sseSource = null;

  function authHeaders() { return { 'Authorization': 'Bearer ' + token }; }

  async function apiFetch(url) {
    const r = await fetch(url, { headers: authHeaders() });
    if (r.status === 401) { localStorage.removeItem('varone_token'); window.location.href = '/login'; }
    return r.json();
  }

  function logout() {
    localStorage.removeItem('varone_token');
    window.location.href = '/login';
  }

  // ── STATS ──────────────────────────────────────────────
  async function cargarStats() {
    const d = await apiFetch('/api/stats');
    document.getElementById('stat-hoy').textContent = d.hoy ?? '—';
    document.getElementById('stat-total').textContent = d.total ?? '—';
    // Mostrar botón de reintento si hay pendientes
    const btn = document.getElementById('btn-reintentar');
    const count = d.pendientesFramer ?? 0;
    if (count > 0) {
      document.getElementById('pendientes-count').textContent = count;
      btn.style.display = 'block';
    } else {
      btn.style.display = 'none';
    }
    const waBadge = document.getElementById('wa-badge');
    if (d.waStatus === 'connected') {
      waBadge.textContent = 'WA Conectado'; waBadge.className = 'topbar-badge badge-live';
    } else if (d.waStatus === 'qr') {
      waBadge.textContent = 'Escanear QR'; waBadge.className = 'topbar-badge badge-warn';
      cargarQR();
    } else {
      waBadge.textContent = 'WA Desconectado'; waBadge.className = 'topbar-badge badge-off';
    }
  }

  async function cargarMetrics() {
    const d = await apiFetch('/api/metrics');
    document.getElementById('stat-uptime').textContent = d.uptime ?? '—';
  }

  async function cargarQR() {
    const d = await apiFetch('/api/qr');
    if (d.qr) {
      document.getElementById('qr-img').src = d.qr;
      document.getElementById('qr-overlay').style.display = 'flex';
    }
  }

  // ── REPORTES ───────────────────────────────────────────
  function gravColor(g) {
    if (g === 'alta') return 'grav-alta';
    if (g === 'media') return 'grav-media';
    return 'grav-baja';
  }
  function gravLabel(g) {
    if (g === 'alta') return '🔴 Alta';
    if (g === 'media') return '🟡 Media';
    return '🟢 Baja';
  }
  function tipoLabel(t) {
    const m = { robo_de_carga:'Robo de carga', asalto:'Asalto', tentativa:'Tentativa', bloqueo:'Bloqueo', alerta:'Alerta', accidente:'Accidente' };
    return m[t] || t;
  }
  function fmtFecha(iso) {
    return new Date(iso).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  async function cargarReportes(pag) {
    paginaActual = pag || paginaActual;
    const tipo = document.getElementById('filtro-tipo').value;
    const gravedad = document.getElementById('filtro-gravedad').value;
    const busqueda = document.getElementById('filtro-busqueda').value;
    let url = '/api/reportes?pagina=' + paginaActual + '&porPagina=20';
    if (tipo !== 'todos') url += '&tipo=' + encodeURIComponent(tipo);
    if (gravedad !== 'todos') url += '&gravedad=' + encodeURIComponent(gravedad);
    if (busqueda) url += '&busqueda=' + encodeURIComponent(busqueda);

    const d = await apiFetch(url);
    const list = document.getElementById('reportes-list');

    if (!d.reportes?.length) {
      list.innerHTML = '<div style="text-align:center;color:#475569;padding:40px;font-size:13px;">Sin reportes para los filtros seleccionados.</div>';
      document.getElementById('paginacion').style.display = 'none';
      return;
    }

    list.innerHTML = d.reportes.map(r => \`
      <div class="reporte-card \${r.gravedad || ''}" onclick='abrirModal(\${JSON.stringify(r).replace(/'/g, "&#39;")})'>
        <div class="rc-header">
          <span class="rc-tipo">\${tipoLabel(r.tipoIncidente)}</span>
          \${r.gravedad ? \`<span class="rc-gravedad \${gravColor(r.gravedad)}">\${gravLabel(r.gravedad)}</span>\` : ''}
          <span class="rc-ubicacion">\${r.ubicacion}</span>
        </div>
        \${r.ruta && r.ruta !== 'no especificada' ? \`<div class="rc-ruta">📍 \${r.ruta}</div>\` : ''}
        <div class="rc-desc">\${r.descripcion}</div>
        <div class="rc-meta">
          <span>\${fmtFecha(r.creadoEn)}</span>
          <span style="color:\${r.framerEnviado ? '#4ade80' : '#f87171'}">\${r.framerEnviado ? '✓ Framer' : '✗ Pendiente'}</span>
        </div>
      </div>
    \`).join('');

    const totalPag = d.totalPaginas || 1;
    if (totalPag > 1) {
      document.getElementById('paginacion').style.display = 'flex';
      document.getElementById('pag-info').textContent = 'Página ' + paginaActual + ' de ' + totalPag + ' (' + d.total + ' reportes)';
      document.getElementById('pag-prev').disabled = paginaActual <= 1;
      document.getElementById('pag-next').disabled = paginaActual >= totalPag;
    } else {
      document.getElementById('paginacion').style.display = 'none';
    }
  }

  function cambiarPagina(delta) { cargarReportes(paginaActual + delta); }
  function debounceSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(() => cargarReportes(1), 400); }

  function abrirModal(r) {
    const set = (id, val) => { document.getElementById(id).textContent = val || '—'; };
    document.getElementById('modal-titulo').textContent = tipoLabel(r.tipoIncidente) + ' — ' + (r.ubicacion || '—');
    set('modal-tipo', tipoLabel(r.tipoIncidente));
    set('modal-gravedad', r.gravedad ? gravLabel(r.gravedad) : '—');
    set('modal-fecha', r.fecha || '—');
    set('modal-hora', r.hora || '—');
    set('modal-ubicacion', r.ubicacion);
    set('modal-ruta', r.ruta && r.ruta !== 'no especificada' ? r.ruta : '—');
    set('modal-vehiculo', r.vehiculo);
    set('modal-patente', r.patente);
    set('modal-victimas', r.victimas);
    set('modal-detenidos', r.detenidos);
    set('modal-descripcion', r.descripcion);
    set('modal-original', r.textoOriginal);
    const urlRow = document.getElementById('modal-url-row');
    if (r.urlNoticia) {
      document.getElementById('modal-url').href = r.urlNoticia;
      document.getElementById('modal-url').textContent = r.urlNoticia;
      urlRow.style.display = 'block';
    } else {
      urlRow.style.display = 'none';
    }
    document.getElementById('modal-detalle').style.display = 'flex';
  }

  function cerrarModal() {
    document.getElementById('modal-detalle').style.display = 'none';
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

  async function reintentarFramer() {
    const btn = document.getElementById('btn-reintentar');
    btn.textContent = '↻ Reintentando...';
    btn.disabled = true;
    try {
      const d = await fetch('/api/framer/reintentar', { method: 'POST', headers: authHeaders() }).then(r => r.json());
      if (d.ok) {
        const restantes = d.pendientesRestantes ?? 0;
        if (restantes === 0) {
          btn.style.display = 'none';
        } else {
          document.getElementById('pendientes-count').textContent = restantes;
          btn.innerHTML = \`↻ Reintentar Framer (<span id="pendientes-count">\${restantes}</span>)\`;
        }
        cargarReportes(paginaActual);
      }
    } finally {
      btn.disabled = false;
    }
  }

  function exportarCSV() {
    const tipo = document.getElementById('filtro-tipo').value;
    const gravedad = document.getElementById('filtro-gravedad').value;
    const busqueda = document.getElementById('filtro-busqueda').value;
    let url = '/api/exportar?token=' + token;
    if (tipo !== 'todos') url += '&tipo=' + encodeURIComponent(tipo);
    if (gravedad !== 'todos') url += '&gravedad=' + encodeURIComponent(gravedad);
    if (busqueda) url += '&busqueda=' + encodeURIComponent(busqueda);
    window.open(url, '_blank');
  }

  // ── RESUMEN IA ──────────────────────────────────────────
  async function cargarResumen() {
    const box = document.getElementById('resumen-box');
    const txt = document.getElementById('resumen-texto');
    box.style.display = 'block';
    txt.textContent = 'Generando resumen...';
    const d = await apiFetch('/api/resumen-diario');
    txt.textContent = d.resumen || '—';
  }

  // ── WA STATUS (actualiza badge sin polling) ────────────
  function aplicarWaStatus(status) {
    const waBadge = document.getElementById('wa-badge');
    if (status === 'connected') {
      waBadge.textContent = 'WA Conectado'; waBadge.className = 'topbar-badge badge-live';
      document.getElementById('qr-overlay').style.display = 'none';
    } else if (status === 'qr') {
      waBadge.textContent = 'Escanear QR'; waBadge.className = 'topbar-badge badge-warn';
    } else {
      waBadge.textContent = 'WA Desconectado'; waBadge.className = 'topbar-badge badge-off';
    }
  }

  // ── SSE — CHAT EN TIEMPO REAL ───────────────────────────
  function conectarSSE() {
    const dot = document.getElementById('chat-conn-dot');
    const label = document.getElementById('chat-conn-label');

    if (sseSource) sseSource.close();

    sseSource = new EventSource('/api/mensajes/stream?token=' + token);

    sseSource.onopen = () => {
      dot.classList.add('connected');
      label.textContent = 'En vivo';
      label.style.color = '#4ade80';
    };

    sseSource.onerror = () => {
      dot.classList.remove('connected');
      label.textContent = 'Reconectando...';
      label.style.color = '#f59e0b';
      // EventSource reconecta automáticamente
    };

    // Estado inicial + nombre del grupo + backfill
    sseSource.addEventListener('init', (e) => {
      const d = JSON.parse(e.data);
      aplicarWaStatus(d.waStatus);
      if (d.grupoNombre) {
        document.getElementById('chat-grupo-nombre').textContent = d.grupoNombre;
      }
    });

    // Mensajes del grupo (en vivo + backfill al conectar)
    sseSource.addEventListener('mensaje', (e) => {
      const msg = JSON.parse(e.data);
      agregarMensaje(msg);
    });

    // QR push: llega inmediatamente cuando WA lo genera, sin esperar polling
    sseSource.addEventListener('qr', (e) => {
      const d = JSON.parse(e.data);
      aplicarWaStatus('qr');
      document.getElementById('qr-img').src = d.qr;
      document.getElementById('qr-overlay').style.display = 'flex';
    });

    // Cambio de estado de WA (connected / disconnected)
    sseSource.addEventListener('wa_status', (e) => {
      const d = JSON.parse(e.data);
      aplicarWaStatus(d.status);
      // Al reconectar refrescar stats para actualizar contadores
      if (d.status === 'connected') { cargarStats(); cargarMetrics(); }
    });

    // Resultado de procesamiento IA: actualiza el ícono en la burbuja del mensaje
    sseSource.addEventListener('procesado', (e) => {
      const d = JSON.parse(e.data);
      const bubble = document.querySelector('[data-msg-id="' + d.id + '"]');
      if (bubble) {
        const indicator = bubble.querySelector('.msg-indicator');
        if (indicator) {
          if (d.fueReporte) {
            indicator.textContent = '🚨 Reporte registrado';
            indicator.style.color = '#f87171';
          } else {
            indicator.textContent = '✓ Sin novedad';
            indicator.style.color = '#475569';
          }
        }
      }
      // Notificación del browser si es reporte de gravedad alta
      if (d.fueReporte && d.gravedad === 'alta') {
        notificarBrowser('🚨 Reporte de gravedad ALTA', d.ubicacion ? 'Ubicación: ' + d.ubicacion : 'Nuevo incidente registrado');
      }
    });
  }

  function agregarMensaje(msg) {
    const container = document.getElementById('chat-messages');
    const empty = document.getElementById('chat-empty');
    if (empty) empty.style.display = 'none';

    // No duplicar mensajes del backfill si ya están en el DOM
    if (document.querySelector('[data-msg-id="' + msg.id + '"]')) return;

    const isMultimedia = msg.type !== 'chat';
    const hora = new Date(msg.timestamp * 1000).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    const body = isMultimedia ? msg.body : escapeHtml(msg.body);

    // Estado procesado: null = analizando (solo para msgs en vivo), true/false = resultado conocido
    const indicatorHtml = msg.procesado === true
      ? '<div class="msg-indicator" style="font-size:10px;color:#f87171;margin-top:2px;">🚨 Reporte registrado</div>'
      : msg.procesado === false
        ? '<div class="msg-indicator" style="font-size:10px;color:#475569;margin-top:2px;">✓ Sin novedad</div>'
        : msg.type === 'chat'
          ? '<div class="msg-indicator" style="font-size:10px;color:#334155;margin-top:2px;">· analizando...</div>'
          : '';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble msg-new';
    bubble.setAttribute('data-msg-id', msg.id);
    bubble.innerHTML = \`
      <div class="msg-name">\${escapeHtml(msg.fromName)}</div>
      <div class="msg-text \${isMultimedia ? 'multimedia' : ''}">\${body}</div>
      <div class="msg-time">\${hora}</div>
      \${indicatorHtml}
    \`;
    container.appendChild(bubble);

    // Limitar a 200 mensajes para no saturar el DOM
    const bubbles = container.querySelectorAll('.msg-bubble');
    if (bubbles.length > 200) bubbles[0].remove();

    msgCount++;
    document.getElementById('chat-count').textContent = msgCount + ' mensaje' + (msgCount !== 1 ? 's' : '') + ' recibido' + (msgCount !== 1 ? 's' : '');

    // Auto-scroll solo si el usuario está al final
    if (autoScroll) container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Detectar si el usuario scrolleó hacia arriba (deshabilitar auto-scroll)
  document.addEventListener('DOMContentLoaded', () => {
    const c = document.getElementById('chat-messages');
    if (c) c.addEventListener('scroll', () => {
      autoScroll = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
    });
  });

  // ── NOTIFICACIONES DEL BROWSER ─────────────────────────
  function notificarBrowser(titulo, cuerpo) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(titulo, { body: cuerpo, icon: '/favicon.ico', tag: 'varone-alerta' });
    }
  }

  function pedirPermisoNotificaciones() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ── INIT ───────────────────────────────────────────────
  function init() {
    cargarStats();
    cargarMetrics();
    cargarReportes(1);
    cargarResumen();
    conectarSSE();
    pedirPermisoNotificaciones();
    // El SSE ya actualiza el estado WA en tiempo real.
    // Polling solo para stats/reportes (contadores, paginación).
    setInterval(() => { cargarStats(); cargarMetrics(); }, 30_000);
    setInterval(() => cargarReportes(paginaActual), 30_000);
  }
</script>
</body>
</html>`;

