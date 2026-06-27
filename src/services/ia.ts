import logger from './logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { ENV } from '../config/env';
import { SYSTEM_PROMPT } from '../config/prompts';
import { RespuestaIA } from '../types';
import { captureException } from '../lib/sentry';

// Singletons — evitar instanciar un nuevo cliente en cada llamada
let _geminiModel: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']> | null = null;
let _openaiClient: OpenAI | null = null;

function getGemini() {
  if (!_geminiModel) {
    const genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
    _geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }
  return _geminiModel;
}

function getOpenAI() {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
  }
  return _openaiClient;
}

/**
 * Sprint hardening 13-mejoras (2026-06-27) — retries con exponential backoff
 * + rate-limit handling. Patrón canonical (replica del proyecto noticias).
 *
 * Errores transient retryables:
 *  - HTTP 429 (rate limit) → espera más larga
 *  - HTTP 5xx (server side)
 *  - Network errors (ECONNRESET, ETIMEDOUT, socket, fetch failed)
 *
 * Errores NO retryables (validación / auth) → fail-fast.
 *
 * Si después de 3 intentos sigue fallando → {esRelevante:false} (best-effort)
 * + captureException a Sentry para que el operador se entere.
 */

const MAX_INTENTOS = 3;

export function esErrorRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Rate limit / quota
  if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) return true;
  if (msg.includes('limit') && !msg.includes('time limit')) return true;
  // 5xx
  if (msg.match(/5\d{2}/)) return true;
  // Network
  if (msg.includes('econn') || msg.includes('etimedout') || msg.includes('network')) return true;
  if (msg.includes('socket') || msg.includes('fetch failed')) return true;
  return false;
}

export function esRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('429') || msg.includes('rate') || msg.includes('quota');
}

async function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function analizarConIA(texto: string): Promise<RespuestaIA> {
  let ultimoError: unknown = null;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const respuestaRaw = await invocarProveedor(texto);
      return parsearRespuesta(respuestaRaw);
    } catch (err) {
      ultimoError = err;
      const retryable = esErrorRetryable(err);
      const rateLimit = esRateLimitError(err);

      logger.warn(
        `[IA] intento ${intento}/${MAX_INTENTOS} falló (retryable=${retryable} rateLimit=${rateLimit}): ${err instanceof Error ? err.message : String(err)}`,
      );

      if (!retryable || intento === MAX_INTENTOS) {
        break;
      }

      // Exponential backoff. Rate limit espera más.
      const baseMs = rateLimit ? 8_000 : 1_000;
      const espera = baseMs * Math.pow(4, intento - 1);
      logger.info(`[IA] esperando ${espera}ms antes del retry`);
      await dormir(espera);
    }
  }

  logger.error(`[IA] fallida después de ${MAX_INTENTOS} retries — descartando`);
  captureException(ultimoError, { service: 'ia', maxIntentos: MAX_INTENTOS });
  return { esRelevante: false, reporte: null };
}

async function invocarProveedor(texto: string): Promise<string> {
  const prompt = `${SYSTEM_PROMPT}\n\nTexto a analizar:\n"${texto}"`;

  if (ENV.AI_PROVIDER === 'gemini') {
    const model = getGemini();
    const result = await model.generateContent(prompt);
    return result.response.text();
  } else {
    const openai = getOpenAI();
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: texto },
      ],
      response_format: { type: 'json_object' },
    });
    return result.choices[0]?.message?.content || '{}';
  }
}

export function parsearRespuesta(raw: string): RespuestaIA {
  // Limpiar markdown si la IA envuelve en ```json
  const limpio = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  if (ENV.LOG_LEVEL === 'debug') {
    logger.info(`[IA] Respuesta raw: ${limpio.substring(0, 300)}`);
  }

  try {
    return JSON.parse(limpio) as RespuestaIA;
  } catch {
    logger.error(`[IA] Error parseando respuesta: ${limpio.substring(0, 200)}`);
    return { esRelevante: false, reporte: null };
  }
}

/** Exportado para tests. */
export const _internals = { esErrorRetryable, esRateLimitError, parsearRespuesta };
