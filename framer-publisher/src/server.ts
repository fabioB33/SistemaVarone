/**
 * framer-publisher — microservicio Express en :4001.
 *
 * Aislado en ESM porque framer-api es ESM-only y el resto del Sistema Varone
 * vive en CommonJS. El servicio principal (Sistema Varone) llama a estos
 * endpoints por HTTP en localhost.
 *
 * Endpoints:
 *  GET  /health                    healthcheck
 *  GET  /noticias                  lista items actuales en "Notas"
 *  POST /noticia                   crea 1 item en draft (no publica el sitio)
 *  POST /publish                   publica el sitio (publish + deploy)
 *  POST /og-image                  extrae og:image de una URL (utility)
 *
 * Auth: header X-Publisher-Token coincide con FRAMER_PUBLISHER_TOKEN.
 *       Si la var no está seteada, no se valida (modo dev).
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import {
  publishNoticia,
  publishSite,
  listNoticias,
  disconnectFramer,
  type PublishInput,
} from './framer.js';
import { extractOgImage } from './og-image.js';
import { buildSlug } from './slug.js';

const PORT = parseInt(process.env.FRAMER_PUBLISHER_PORT || '4001', 10);
const TOKEN = process.env.FRAMER_PUBLISHER_TOKEN || '';

const app = express();
app.use(express.json({ limit: '256kb' }));

// ─── Auth simple ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!TOKEN) return next(); // modo dev sin token
  if (req.header('X-Publisher-Token') !== TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// ─── Endpoints ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'framer-publisher', port: PORT });
});

app.get('/noticias', async (_req, res, next) => {
  try {
    const items = await listNoticias();
    res.json({ count: items.length, items });
  } catch (err) {
    next(err);
  }
});

interface NoticiaBody {
  title: string;
  link: string;
  date?: string;
  content?: string;
  metaDescription?: string;
  slug?: string;
  imageUrl?: string;
  featured?: boolean;
  /** Si true, intenta extraer og:image de `link` cuando imageUrl falta. */
  autoOgImage?: boolean;
}

app.post('/noticia', async (req, res, next) => {
  try {
    const b = req.body as NoticiaBody;
    if (!b?.title || !b?.link) {
      res.status(400).json({ error: 'title y link son requeridos' });
      return;
    }

    const date =
      b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)
        ? b.date
        : new Date().toISOString().slice(0, 10);

    let imageUrl = b.imageUrl?.trim() || undefined;
    if (!imageUrl && b.autoOgImage !== false) {
      const og = await extractOgImage(b.link);
      if (og) imageUrl = og;
    }

    const slug = b.slug?.trim() || buildSlug(b.title, String(Date.now()).slice(-6));

    const input: PublishInput = {
      title: b.title.trim(),
      link: b.link.trim(),
      date,
      content: b.content?.trim() || `<p>${b.title.trim()}</p>`,
      metaDescription:
        b.metaDescription?.trim() || b.title.trim().slice(0, 160),
      slug,
      imageUrl,
      featured: b.featured ?? false,
    };

    const result = await publishNoticia(input);
    res.json({ ok: true, ...result, imageUrl: imageUrl ?? null });
  } catch (err) {
    next(err);
  }
});

app.post('/publish', async (_req, res, next) => {
  try {
    const result = await publishSite();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.post('/og-image', async (req, res, next) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: 'url requerida' });
      return;
    }
    const og = await extractOgImage(url);
    res.json({ url: og });
  } catch (err) {
    next(err);
  }
});

// ─── Error handler ──────────────────────────────────────────────────────────
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[framer-publisher] error en ${req.method} ${req.path}:`, message);
  if (stack) console.error(stack);
  res.status(500).json({ error: message });
});

// ─── Start ──────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[framer-publisher] escuchando en http://127.0.0.1:${PORT}`);
  if (!TOKEN) console.warn('[framer-publisher] sin FRAMER_PUBLISHER_TOKEN — modo dev sin auth');
});

// ─── Shutdown limpio ────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[framer-publisher] ${signal} recibido, cerrando...`);
  server.close(() => {
    void disconnectFramer().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
