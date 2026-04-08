import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');

const formats = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: formats,
  transports: [
    // Consola — mantiene el comportamiento actual
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        formats
      ),
    }),
    // Archivo rotativo diario — guarda 14 días
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'varone-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      zippedArchive: true,
    }),
    // Archivo separado solo para errores
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'varone-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
});

export default logger;
