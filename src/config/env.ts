import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  // Base de datos
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/sistema_varone',

  // IA (Gemini o OpenAI)
  AI_PROVIDER: (process.env.AI_PROVIDER || 'gemini') as 'gemini' | 'openai',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // WhatsApp
  WA_GROUP_NAME: process.env.WA_GROUP_NAME || '',

  // Framer
  FRAMER_ENDPOINT: process.env.FRAMER_ENDPOINT || '',

  // Scraping
  SCRAPING_INTERVAL_MINUTES: parseInt(process.env.SCRAPING_INTERVAL_MINUTES || '120', 10),

  // General
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
