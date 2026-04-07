import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { ENV } from '../config/env';
import { SYSTEM_PROMPT } from '../config/prompts';
import { RespuestaIA } from '../types';

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

export async function analizarConIA(texto: string): Promise<RespuestaIA> {
  const prompt = `${SYSTEM_PROMPT}\n\nTexto a analizar:\n"${texto}"`;

  let respuestaRaw: string;

  try {
    if (ENV.AI_PROVIDER === 'gemini') {
      const model = getGemini();
      const result = await model.generateContent(prompt);
      respuestaRaw = result.response.text();
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
      respuestaRaw = result.choices[0]?.message?.content || '{}';
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[IA] Error en llamada a ${ENV.AI_PROVIDER}:`, errorMsg);
    throw error; // Propagar el error en vez de fallar silenciosamente
  }

  // Limpiar markdown si la IA envuelve en ```json
  respuestaRaw = respuestaRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  if (ENV.LOG_LEVEL === 'debug') {
    console.log('[IA] Respuesta raw:', respuestaRaw.substring(0, 300));
  }

  try {
    const parsed: RespuestaIA = JSON.parse(respuestaRaw);
    return parsed;
  } catch {
    console.error('[IA] Error parseando respuesta:', respuestaRaw.substring(0, 200));
    return { esRelevante: false, reporte: null };
  }
}
