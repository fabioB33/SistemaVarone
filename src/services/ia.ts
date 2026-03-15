import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { ENV } from '../config/env';
import { SYSTEM_PROMPT } from '../config/prompts';
import { RespuestaIA } from '../types';

// Gemini
function getGemini() {
  const genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

// OpenAI
function getOpenAI() {
  return new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
}

export async function analizarConIA(texto: string): Promise<RespuestaIA> {
  const prompt = `${SYSTEM_PROMPT}\n\nTexto a analizar:\n"${texto}"`;

  let respuestaRaw: string;

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

  // Limpiar markdown si la IA envuelve en ```json
  respuestaRaw = respuestaRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    const parsed: RespuestaIA = JSON.parse(respuestaRaw);
    return parsed;
  } catch {
    console.error('[IA] Error parseando respuesta:', respuestaRaw.substring(0, 200));
    return { esRelevante: false, reporte: null };
  }
}
