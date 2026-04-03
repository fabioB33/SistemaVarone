import express from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';
import { ENV } from '../config/env';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

const prisma = new PrismaClient();

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
let lastScrapingTime: Date | null = null;
let scrapingStatus: string = 'Sin ejecutar';

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

// Funciones para actualizar estado desde index.ts
export function setQrData(qr: string) {
  qrData = qr;
  waStatus = 'qr';
}
export function setWaConnected() {
  waStatus = 'connected';
  qrData = null;
}
export function setWaDisconnected() {
  waStatus = 'disconnected';
  qrData = null;
}
export function setScrapingStatus(status: string) {
  scrapingStatus = status;
  lastScrapingTime = new Date();
}

// Notifica desconexión de WhatsApp al log y opcionalmente a Telegram
export async function notificarDesconexion(reason: string): Promise<void> {
  const msg = `[ALERTA] WhatsApp desconectado: ${reason} — ${new Date().toLocaleString('es-AR')}`;
  console.error(msg);

  // Si hay webhook de Telegram configurado, enviar alerta
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  if (telegramToken && telegramChatId) {
    try {
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: `🚨 *Sistema Varone*\nWhatsApp desconectado\nMotivo: ${reason}\nHora: ${new Date().toLocaleString('es-AR')}\n\nReconexión automática en 10 segundos.`,
          parse_mode: 'Markdown',
        }),
      });
      console.log('[Alerta] Notificación enviada a Telegram.');
    } catch (e) {
      console.error('[Alerta] Error enviando a Telegram:', e);
    }
  }
}

export function startDashboard(port: number = 3000, onForzarScraping?: () => void) {
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
    const token = req.headers.authorization?.replace('Bearer ', '') ||
                  req.query.token as string;
    if (token && activeSessions.has(token)) {
      const expires = activeSessions.get(token) ?? 0;
      if (Date.now() < expires) return next();
      activeSessions.delete(token);
    }
    res.status(401).json({ error: 'No autorizado' });
  });

  // API: forzar scraping manual
  app.post('/api/scraper/run', (_req, res) => {
    if (onForzarScraping) {
      onForzarScraping();
      res.json({ ok: true, mensaje: 'Scraping iniciado.' });
    } else {
      res.status(503).json({ ok: false, error: 'Scraper no disponible.' });
    }
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

    const reportes = await prisma.reporte.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: 200,
    });
    res.json(reportes);
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
    res.json({
      total,
      hoy: hoyCount,
      porTipo: porTipo.map(r => ({ tipo: r.tipo_incidente, count: Number(r.count) })),
      porFuente: porFuente.map(r => ({ fuente: r.fuente, count: Number(r.count) })),
      porGravedad: porGravedad.map(r => ({ gravedad: r.gravedad, count: Number(r.count) })),
      waStatus,
      scrapingStatus,
      lastScrapingTime,
    });
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

    const header = 'Fecha,Hora,Ubicación,Ruta,Tipo,Gravedad,Fuente,Descripción,Víctimas,Detenidos,URL\n';
    const rows = reportes.map(r => {
      const creado = new Date(r.creadoEn);
      const fecha = creado.toLocaleDateString('es-AR');
      const hora = creado.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const esc = (s: string | null) => s ? '"' + s.replace(/"/g, '""') + '"' : '';
      return [fecha, hora, esc(r.ubicacion), esc(r.ruta), esc(r.tipoIncidente), r.gravedad || '', r.fuente, esc(r.descripcion), esc(r.victimas), esc(r.detenidos), r.urlNoticia || ''].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reportes-varone-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send('\uFEFF' + header + rows);
  });

  // API: resumen diario generado con IA (persiste en DB para sobrevivir reinicios)
  let resumenCache: { texto: string; generadoEn: number } | null = null;
  let resumenEnProgreso = false;
  const RESUMEN_TTL = 10 * 60 * 1000; // 10 minutos de cache en memoria

  app.get('/api/resumen-diario', async (_req, res) => {
    try {
      // 1. Servir desde cache en memoria si es reciente
      if (resumenCache && (Date.now() - resumenCache.generadoEn) < RESUMEN_TTL) {
        res.json({ resumen: resumenCache.texto, cached: true });
        return;
      }

      const fechaHoy = new Date().toISOString().split('T')[0];

      // 2. Buscar en DB si ya se generó hoy (sobrevive reinicios del proceso)
      const resumenDB = await prisma.resumenDiario.findUnique({ where: { fecha: fechaHoy } });
      if (resumenDB) {
        resumenCache = { texto: resumenDB.texto, generadoEn: Date.now() };
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

      resumenCache = { texto: resumenTexto, generadoEn: Date.now() };
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }

    /* Header */
    .header { background: #1e293b; padding: 16px 32px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 20px; font-weight: 600; }
    .header .live-badge { background: #ef4444; color: white; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1px; animation: live-blink 2s infinite; margin-left: 12px; }
    @keyframes live-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .header .status { display: flex; gap: 16px; align-items: center; font-size: 13px; color: #94a3b8; }
    .header .clock { font-size: 14px; font-weight: 600; color: #e2e8f0; font-variant-numeric: tabular-nums; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .status-dot.green { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
    .status-dot.yellow { background: #eab308; box-shadow: 0 0 8px #eab308; }
    .status-dot.red { background: #ef4444; box-shadow: 0 0 8px #ef4444; }

    /* Layout */
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
    @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    .card { background: #1e293b; border-radius: 12px; padding: 16px; border: 1px solid #334155; opacity: 0; transform: translateY(16px); animation: card-enter 0.5s ease-out forwards; transition: transform 0.25s, box-shadow 0.25s; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px -4px rgba(0,0,0,0.4); }
    .card:nth-child(1) { animation-delay: 0s; }
    .card:nth-child(2) { animation-delay: 0.07s; }
    .card:nth-child(3) { animation-delay: 0.14s; }
    .card:nth-child(4) { animation-delay: 0.21s; }
    .card:nth-child(5) { animation-delay: 0.28s; }
    @keyframes card-enter { to { opacity: 1; transform: translateY(0); } }
    .card h3 { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .card .value { font-size: 28px; font-weight: 700; }
    .card .value.blue { color: #3b82f6; }
    .card .value.green { color: #22c55e; }
    .card .value.orange { color: #f97316; }
    .card .value.red { color: #ef4444; }
    .card .value.yellow { color: #eab308; }
    .card .sub { font-size: 11px; color: #64748b; margin-top: 2px; }

    /* Panels */
    .panels { display: grid; grid-template-columns: 1fr 340px; gap: 20px; }
    @media (max-width: 900px) { .panels { grid-template-columns: 1fr; } }
    .panel { background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden; }
    .panel-header { padding: 14px 20px; border-bottom: 1px solid #334155; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
    .panel-header .filter-bar { display: flex; gap: 6px; }
    .filter-btn { background: #334155; border: none; color: #94a3b8; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: all 0.2s; }
    .filter-btn:hover { background: #475569; color: #e2e8f0; }
    .filter-btn.active { background: #3b82f6; color: white; }
    .panel-body { padding: 0; max-height: 700px; overflow-y: auto; }

    /* Reportes */
    .reporte { padding: 16px 20px; border-bottom: 1px solid #334155; transition: background 0.3s, box-shadow 0.3s, transform 0.3s; }
    .reporte:hover { background: #1a2744; box-shadow: inset 0 0 0 1px #334155, 0 4px 16px -2px rgba(0,0,0,0.3); transform: translateY(-2px); }
    .reporte:last-child { border-bottom: none; }
    .reporte-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .reporte .tipo { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .tipo-robo { background: #ef44441a; color: #f87171; }
    .tipo-asalto { background: #f973161a; color: #fb923c; }
    .tipo-bloqueo { background: #eab3081a; color: #facc15; }
    .tipo-alerta { background: #3b82f61a; color: #60a5fa; }
    .tipo-tentativa { background: #a855f71a; color: #c084fc; }
    .gravedad-alta { border-left: 3px solid #ef4444; }
    .gravedad-media { border-left: 3px solid #f97316; }
    .gravedad-baja { border-left: 3px solid #3b82f6; }
    .badge-gravedad { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; text-transform: uppercase; }
    .badge-gravedad-alta { background: #ef44442a; color: #f87171; }
    .badge-gravedad-media { background: #f973162a; color: #fb923c; }
    .badge-gravedad-baja { background: #3b82f62a; color: #60a5fa; }
    .badge-nuevo { background: #ef4444; color: white; font-size: 9px; padding: 2px 7px; border-radius: 3px; font-weight: 700; animation: nuevo-glow 1.5s ease-in-out infinite; }
    @keyframes nuevo-glow { 0%,100% { box-shadow: 0 0 4px #ef444480; } 50% { box-shadow: 0 0 12px #ef4444cc, 0 0 24px #ef444440; } }
    .badge-fuente { font-size: 11px; padding: 2px 6px; border-radius: 3px; }
    .badge-wa { background: #22c55e1a; color: #4ade80; }
    .badge-scraping { background: #3b82f61a; color: #60a5fa; }
    .portal-name { font-size: 11px; padding: 2px 6px; border-radius: 3px; background: #8b5cf61a; color: #a78bfa; }
    .reporte .desc { font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 8px; }
    .reporte .ubicacion-line { font-size: 13px; color: #94a3b8; margin-bottom: 4px; }
    .reporte .ubicacion-line strong { color: #e2e8f0; }
    .reporte .detail-row { font-size: 12px; color: #94a3b8; display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 4px; }
    .reporte .detail-row span { display: flex; align-items: center; gap: 4px; }
    .reporte .meta { font-size: 12px; color: #64748b; display: flex; justify-content: space-between; align-items: center; }
    .reporte .timestamp { font-variant-numeric: tabular-nums; }
    .reporte .url-link { font-size: 12px; color: #3b82f6; text-decoration: none; }
    .reporte .url-link:hover { text-decoration: underline; color: #60a5fa; }
    .btn-share-wa { display: inline-flex; align-items: center; gap: 6px; background: #25D36618; border: 1px solid #25D36650; color: #25D366; padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; transition: all 0.3s; }
    .btn-share-wa:hover { background: #25D36630; border-color: #25D366; color: #fff; transform: translateY(-2px); box-shadow: 0 4px 12px #25D36630; }
    .btn-share-wa .wa-icon { font-size: 15px; }

    /* Resumen diario */
    .resumen-card { background: linear-gradient(135deg, #1e293b 0%, #1a2744 50%, #1e1b4b40 100%); border: 1px solid #3b82f650; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; position: relative; overflow: hidden; border-left: 3px solid; border-image: linear-gradient(180deg, #3b82f6, #8b5cf6) 1; opacity: 0; transform: translateY(12px); animation: card-enter 0.6s ease-out 0.4s forwards; }
    .resumen-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899, #8b5cf6, #3b82f6); background-size: 200% 100%; animation: gradient-shift 3s linear infinite; }
    @keyframes gradient-shift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
    .resumen-card::after { content: ''; position: absolute; top: -50%; right: -20%; width: 200px; height: 200px; background: radial-gradient(circle, #3b82f608 0%, transparent 70%); pointer-events: none; }
    .resumen-card .resumen-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.5px; }
    .resumen-card .resumen-header .resumen-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #3b82f620; border-radius: 6px; font-size: 14px; animation: icon-pulse 2s ease-in-out infinite; }
    @keyframes icon-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }
    .resumen-card .resumen-text { font-size: 15px; color: #e2e8f0; line-height: 1.8; }
    .resumen-card .resumen-meta { font-size: 11px; color: #64748b; margin-top: 12px; display: flex; align-items: center; gap: 6px; }
    .resumen-card .resumen-meta::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; }
    .resumen-loading { color: #64748b; font-size: 13px; animation: loading-fade 1.2s ease-in-out infinite; }
    @keyframes loading-fade { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

    /* WhatsApp / QR */
    .qr-section { text-align: center; padding: 24px; }
    .qr-section img { border-radius: 8px; }
    .qr-section .msg { color: #94a3b8; font-size: 14px; margin-top: 12px; }
    .connected-msg { color: #22c55e; font-size: 18px; font-weight: 700; }
    .connected-box { background: #22c55e15; border: 2px solid #22c55e; border-radius: 12px; padding: 20px; text-align: center; }
    .connected-box .icon { font-size: 40px; margin-bottom: 8px; }
    .connected-box .pulse { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #22c55e; margin-right: 8px; animation: pulse-anim 1.5s infinite; }
    @keyframes pulse-anim { 0%,100% { box-shadow: 0 0 0 0 #22c55e80; } 50% { box-shadow: 0 0 0 10px #22c55e00; } }
    .connected-box .grupo { color: #94a3b8; font-size: 13px; margin-top: 8px; }
    .disconnected-box { background: #ef444415; border: 2px dashed #ef4444; border-radius: 12px; padding: 20px; text-align: center; }
    .disconnected-box .icon { font-size: 40px; margin-bottom: 8px; }

    /* Chart */
    .tipo-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .tipo-bar .label { font-size: 13px; color: #94a3b8; width: 120px; }
    .tipo-bar .bar { flex: 1; height: 8px; background: #334155; border-radius: 4px; overflow: hidden; }
    .tipo-bar .fill { height: 100%; border-radius: 4px; animation: bar-grow 0.8s ease-out; transform-origin: left; }
    @keyframes bar-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

    /* Alerta sonora toggle */
    .sound-toggle { background: #334155; border: 1px solid #475569; color: #e2e8f0; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .sound-toggle.active { background: #22c55e20; border-color: #22c55e; color: #22c55e; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:center">
      <h1>Sistema Varone</h1>
      <span class="live-badge">EN VIVO</span>
    </div>
    <div class="status">
      <span class="clock" id="clock"></span>
      <span><span class="status-dot" id="wa-dot"></span> WA: <span id="wa-status">...</span></span>
      <span>Scraping: <span id="scraping-status">...</span></span>
      <button class="sound-toggle" id="sound-toggle" onclick="toggleSound()">&#x1F514; Alertas</button>
      <button class="sound-toggle" id="notif-toggle" onclick="toggleNotifications()">&#x1F4E8; Notificaciones</button>
      <button class="sound-toggle" onclick="logout()" style="border-color:#ef4444;color:#f87171;">&#x274C; Salir</button>
    </div>
  </div>

  <div class="container">
    <div class="grid" id="stats-grid"></div>

    <div id="resumen-diario-container"></div>

    <div class="panels">
      <div class="panel">
        <div class="panel-header">
          <span>Reportes recientes</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="search-input" placeholder="Buscar ubicación, ruta, palabra..." style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:5px 10px;border-radius:6px;font-size:12px;width:220px;outline:none;" oninput="onSearch()" />
            <button class="sound-toggle" onclick="exportCSV()" title="Descargar CSV">&#x1F4E5; CSV</button>
          </div>
        </div>
        <div class="panel-header" style="padding:8px 20px;border-bottom:1px solid #334155;">
          <div class="filter-bar">
            <button class="filter-btn active" onclick="setFilter('todos')">Todos</button>
            <button class="filter-btn" onclick="setFilter('alta')">Alta</button>
            <button class="filter-btn" onclick="setFilter('media')">Media</button>
            <button class="filter-btn" onclick="setFilter('whatsapp')">WA</button>
            <button class="filter-btn" onclick="setFilter('scraping')">Scraping</button>
          </div>
        </div>
        <div class="panel-body" id="reportes-list">Cargando...</div>
      </div>

      <div>
        <div class="panel" style="margin-bottom: 16px;">
          <div class="panel-header">WhatsApp</div>
          <div class="panel-body qr-section" id="qr-section">Cargando...</div>
        </div>
        <div class="panel">
          <div class="panel-header">Incidentes por tipo</div>
          <div class="panel-body" style="padding:16px 20px" id="tipos-chart"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Auth: verificar token
    const TOKEN = localStorage.getItem('varone_token');
    if (!TOKEN) { window.location.href = '/login'; }
    function authFetch(url) {
      return fetch(url, { headers: { 'Authorization': 'Bearer ' + TOKEN } }).then(r => {
        if (r.status === 401) { localStorage.removeItem('varone_token'); window.location.href = '/login'; }
        return r;
      });
    }

    function logout() { localStorage.removeItem('varone_token'); window.location.href = '/login'; }

    const COLORS = { 'robo de carga': '#f87171', 'asalto': '#fb923c', 'bloqueo': '#facc15', 'alerta': '#60a5fa', 'tentativa': '#c084fc' };
    let currentFilter = 'todos';
    let lastReporteCount = 0;
    let soundEnabled = false;
    let notifEnabled = false;
    let searchQuery = '';
    let allReportes = [];
    let prevStats = {};

    // Counter animation
    function animateCount(el, target) {
      const start = parseInt(el.textContent) || 0;
      if (start === target) return;
      const duration = 800;
      const startTime = performance.now();
      function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        el.textContent = Math.round(start + (target - start) * ease);
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    // Reloj en vivo
    function updateClock() {
      const now = new Date();
      document.getElementById('clock').textContent = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    setInterval(updateClock, 1000);
    updateClock();

    // Sonido de alerta
    function toggleSound() {
      soundEnabled = !soundEnabled;
      const btn = document.getElementById('sound-toggle');
      btn.className = 'sound-toggle' + (soundEnabled ? ' active' : '');
      btn.innerHTML = (soundEnabled ? '&#x1F514;' : '&#x1F515;') + ' Alertas';
    }
    function playAlert() {
      if (!soundEnabled) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
      } catch(e) {}
    }

    function tipoClass(tipo) {
      if (tipo.includes('robo')) return 'tipo-robo';
      if (tipo.includes('asalto')) return 'tipo-asalto';
      if (tipo.includes('bloqueo')) return 'tipo-bloqueo';
      if (tipo.includes('alerta')) return 'tipo-alerta';
      if (tipo.includes('tentativa')) return 'tipo-tentativa';
      return 'tipo-alerta';
    }

    function formatTimestamp(date) {
      const d = new Date(date);
      const hoy = new Date();
      const isHoy = d.toDateString() === hoy.toDateString();
      const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      if (isHoy) return 'Hoy ' + time;
      const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
      if (d.toDateString() === ayer.toDateString()) return 'Ayer ' + time;
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + time;
    }

    function timeAgo(date) {
      const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
      if (mins < 1) return 'ahora';
      if (mins < 60) return 'hace ' + mins + ' min';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return 'hace ' + hrs + 'h';
      return 'hace ' + Math.floor(hrs / 24) + 'd';
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      renderReportes();
    }

    function buildShareWA(r) {
      const desc = r.descripcion.length > 200 ? r.descripcion.substring(0, 197) + '...' : r.descripcion;
      const urlLine = r.urlNoticia ? String.fromCodePoint(0x1F517) + ' ' + r.urlNoticia : '';
      const parts = [
        String.fromCodePoint(0x1F6A8) + ' ALERTA SEGURIDAD VIAL',
        'Tipo: ' + r.tipoIncidente + ' | Gravedad: ' + (r.gravedad || 'N/A'),
        String.fromCodePoint(0x1F4CD) + ' ' + r.ubicacion + ' — ' + r.ruta,
        desc,
        urlLine,
        '— Sistema Varone'
      ].filter(Boolean).join(String.fromCharCode(10));
      const encoded = encodeURIComponent(parts);
      return '<a class="btn-share-wa" href="https://wa.me/?text=' + encoded + '" target="_blank" title="Compartir por WhatsApp"><span class="wa-icon">&#x1F4F2;</span>Compartir</a>';
    }

    function onSearch() {
      searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
      renderReportes();
    }

    function renderReportes() {
      const el = document.getElementById('reportes-list');
      let filtered = allReportes;
      if (currentFilter === 'alta') filtered = allReportes.filter(r => r.gravedad === 'alta');
      else if (currentFilter === 'media') filtered = allReportes.filter(r => r.gravedad === 'media');
      else if (currentFilter === 'whatsapp') filtered = allReportes.filter(r => r.fuente === 'whatsapp');
      else if (currentFilter === 'scraping') filtered = allReportes.filter(r => r.fuente === 'scraping');

      if (searchQuery) {
        filtered = filtered.filter(r =>
          (r.ubicacion || '').toLowerCase().includes(searchQuery) ||
          (r.ruta || '').toLowerCase().includes(searchQuery) ||
          (r.descripcion || '').toLowerCase().includes(searchQuery) ||
          (r.tipoIncidente || '').toLowerCase().includes(searchQuery)
        );
      }

      if (filtered.length === 0) {
        el.innerHTML = '<p style="color:#64748b;text-align:center;padding:32px">No hay reportes con este filtro</p>';
        return;
      }

      el.innerHTML = filtered.map((r, i) => {
        const isNew = (Date.now() - new Date(r.creadoEn).getTime()) < 300000; // menos de 5 min
        const gravedadClass = r.gravedad ? 'gravedad-' + r.gravedad : '';
        const gravedadBadge = r.gravedad ? '<span class="badge-gravedad badge-gravedad-' + r.gravedad + '">' + r.gravedad + '</span>' : '';

        let portalLabel = '';
        if (r.urlNoticia) {
          try { portalLabel = '<span class="portal-name">' + new URL(r.urlNoticia).hostname.replace('www.', '') + '</span>'; } catch(e) {}
        }

        let detailParts = [];
        if (r.vehiculo) detailParts.push('<span>&#x1F698; ' + r.vehiculo + '</span>');
        if (r.victimas) detailParts.push('<span>&#x1F6A8; ' + r.victimas + '</span>');
        if (r.detenidos) detailParts.push('<span>&#x1F46E; ' + r.detenidos + '</span>');
        const detailRow = detailParts.length > 0 ? '<div class="detail-row">' + detailParts.join('') + '</div>' : '';

        const urlLink = r.urlNoticia
          ? '<a class="url-link" href="' + r.urlNoticia + '" target="_blank">Ver fuente original &#x2192;</a>'
          : '';

        return '<div class="reporte ' + gravedadClass + '">' +
          '<div class="reporte-header">' +
            (isNew ? '<span class="badge-nuevo">NUEVO</span>' : '') +
            '<span class="tipo ' + tipoClass(r.tipoIncidente) + '">' + r.tipoIncidente + '</span>' +
            gravedadBadge +
            '<span class="badge-fuente ' + (r.fuente === 'whatsapp' ? 'badge-wa' : 'badge-scraping') + '">' + r.fuente + '</span>' +
            portalLabel +
          '</div>' +
          '<div class="ubicacion-line"><strong>' + r.ubicacion + '</strong> &#x2014; ' + r.ruta + '</div>' +
          '<div class="desc">' + r.descripcion + '</div>' +
          detailRow +
          '<div class="meta"><span class="timestamp">' + formatTimestamp(r.creadoEn) + ' (' + timeAgo(r.creadoEn) + ')</span><span style="display:flex;gap:8px;align-items:center">' + urlLink + buildShareWA(r) + '</span></div>' +
        '</div>';
      }).join('');
    }

    async function loadStats() {
      const res = await authFetch('/api/stats');
      const data = await res.json();

      document.getElementById('wa-dot').className = 'status-dot ' + (data.waStatus === 'connected' ? 'green' : data.waStatus === 'qr' ? 'yellow' : 'red');
      document.getElementById('wa-status').textContent = data.waStatus === 'connected' ? 'OK' : data.waStatus === 'qr' ? 'QR' : 'Off';
      document.getElementById('scraping-status').textContent = data.scrapingStatus;

      const altaCount = data.porGravedad?.find(g => g.gravedad === 'alta')?.count || 0;

      const waCount = data.porFuente.find(f => f.fuente === 'whatsapp')?.count || 0;
      const scrapCount = data.porFuente.find(f => f.fuente === 'scraping')?.count || 0;
      const statsEl = document.getElementById('stats-grid');
      // Crear estructura solo la primera vez
      if (!statsEl.dataset.init) {
        statsEl.dataset.init = '1';
        statsEl.innerHTML =
          '<div class="card"><h3>Total reportes</h3><div class="value blue" id="stat-total">0</div><div class="sub">desde el inicio</div></div>' +
          '<div class="card"><h3>Hoy</h3><div class="value green" id="stat-hoy">0</div><div class="sub">' + new Date().toLocaleDateString('es-AR') + '</div></div>' +
          '<div class="card"><h3>Gravedad alta</h3><div class="value red" id="stat-alta">0</div><div class="sub">requieren atención</div></div>' +
          '<div class="card"><h3>Via WhatsApp</h3><div class="value orange" id="stat-wa">0</div><div class="sub">tiempo real</div></div>' +
          '<div class="card"><h3>Via scraping</h3><div class="value yellow" id="stat-scrap">0</div><div class="sub">5 portales</div></div>';
      }
      animateCount(document.getElementById('stat-total'), data.total);
      animateCount(document.getElementById('stat-hoy'), data.hoy);
      animateCount(document.getElementById('stat-alta'), altaCount);
      animateCount(document.getElementById('stat-wa'), waCount);
      animateCount(document.getElementById('stat-scrap'), scrapCount);

      const maxCount = Math.max(...data.porTipo.map(t => t.count), 1);
      document.getElementById('tipos-chart').innerHTML = data.porTipo.map(t =>
        '<div class="tipo-bar"><span class="label">' + t.tipo + '</span><div class="bar"><div class="fill" style="width:' + (t.count / maxCount * 100) + '%;background:' + (COLORS[t.tipo] || '#60a5fa') + '"></div></div><span style="font-size:13px;color:#e2e8f0;width:30px;text-align:right">' + t.count + '</span></div>'
      ).join('') || '<p style="color:#64748b">Sin datos</p>';
    }

    async function loadReportes() {
      const res = await authFetch('/api/reportes');
      const reportes = await res.json();

      // Detectar nuevos reportes para alerta sonora y notificación
      if (lastReporteCount > 0 && reportes.length > lastReporteCount) {
        const nuevos = reportes.length - lastReporteCount;
        playAlert();
        sendNotification(nuevos, reportes[0]);
        document.title = '(' + nuevos + ') NUEVO - Sistema Varone';
        setTimeout(() => { document.title = 'Sistema Varone - Monitor en Vivo'; }, 10000);
      }
      lastReporteCount = reportes.length;

      allReportes = reportes;
      renderReportes();
    }

    async function loadQR() {
      const res = await authFetch('/api/qr');
      const data = await res.json();
      const el = document.getElementById('qr-section');

      if (data.status === 'connected') {
        el.innerHTML = '<div class="connected-box"><div class="icon">&#x1F4F1;</div><p class="connected-msg"><span class="pulse"></span>Conectado</p><p class="msg">Escuchando grupo de WhatsApp</p><p class="grupo">"' + (data.groupName || 'pirateria de camiones') + '"</p></div>';
      } else if (data.qr) {
        el.innerHTML = '<img src="' + data.qr + '" alt="QR WhatsApp"><p class="msg">Escanealo con WhatsApp</p>';
      } else {
        el.innerHTML = '<div class="disconnected-box"><div class="icon">&#x1F4F4;</div><p style="color:#ef4444;font-size:16px;font-weight:600">Desconectado</p><p class="msg">Esperando conexión de WhatsApp...</p></div>';
      }
    }

    // Notificaciones del navegador
    function toggleNotifications() {
      const btn = document.getElementById('notif-toggle');
      if (!notifEnabled) {
        if (!('Notification' in window)) {
          alert('Tu navegador no soporta notificaciones');
          return;
        }
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') {
            notifEnabled = true;
            btn.className = 'sound-toggle active';
            btn.innerHTML = '&#x1F4E8; Notif ON';
          } else {
            alert('Permiso de notificaciones denegado');
          }
        });
      } else {
        notifEnabled = false;
        btn.className = 'sound-toggle';
        btn.innerHTML = '&#x1F4E8; Notificaciones';
      }
    }

    function sendNotification(count, latest) {
      if (!notifEnabled || Notification.permission !== 'granted') return;
      const title = count === 1 ? 'Nuevo reporte' : count + ' nuevos reportes';
      const body = latest ? (latest.tipoIncidente.toUpperCase() + ' - ' + latest.ubicacion + ' (' + latest.ruta + ')') : '';
      const n = new Notification(title, { body: body, icon: '&#x1F6A8;', tag: 'varone-alert' });
      n.onclick = () => { window.focus(); n.close(); };
    }

    // Exportar CSV
    function exportCSV() {
      const params = new URLSearchParams();
      if (currentFilter === 'whatsapp' || currentFilter === 'scraping') params.set('fuente', currentFilter);
      if (currentFilter === 'alta' || currentFilter === 'media') params.set('gravedad', currentFilter);
      if (searchQuery) params.set('busqueda', searchQuery);
      params.set('token', TOKEN);
      window.open('/api/exportar?' + params.toString(), '_blank');
    }

    let resumenLoaded = false;
    async function loadResumen() {
      if (resumenLoaded) return; // Solo cargar una vez (se cachea server-side 10min)
      const el = document.getElementById('resumen-diario-container');
      el.innerHTML = '<div class="resumen-card"><div class="resumen-header"><span class="resumen-icon">&#x1F4CA;</span> Resumen del d&#xED;a</div><div class="resumen-loading">Generando resumen con IA...</div></div>';
      try {
        const res = await authFetch('/api/resumen-diario');
        const data = await res.json();
        const now = new Date();
        const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        el.innerHTML = '<div class="resumen-card"><div class="resumen-header"><span class="resumen-icon">&#x1F4CA;</span> Resumen ejecutivo</div><div class="resumen-text">' + data.resumen + '</div><div class="resumen-meta">Generado a las ' + timeStr + (data.cached ? ' (cacheado)' : ' con IA') + '</div></div>';
        resumenLoaded = true;
      } catch(e) {
        el.innerHTML = '';
      }
    }

    async function refresh() {
      await Promise.all([loadStats(), loadReportes(), loadQR()]);
    }

    refresh();
    loadResumen();
    setInterval(refresh, 5000);
    // Refrescar resumen cada 10 minutos
    setInterval(() => { resumenLoaded = false; loadResumen(); }, 600000);
  </script>
</body>
</html>`;
