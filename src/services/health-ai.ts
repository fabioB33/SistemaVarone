/**
 * Health AI: detector de comportamiento anómalo de la IA en modo full-auto.
 *
 * Corre cada hora y dispara alertas WA a Varone si detecta:
 *  A) Silencio sospechoso — entraron muchos mensajes al grupo y la IA no aprobó
 *     ninguno (prompt muy restrictivo o IA degradada).
 *  B) Spike — muchos reportes aprobados en poco tiempo (incidente real masivo
 *     o falso positivo masivo).
 *  C) Pendientes viejos — reportes colgados >1h en pendiente (Framer caído,
 *     bug en pipeline, o reportes sin URL que jamás van a publicarse).
 *  D) Distribución sospechosa — un solo tipo de incidente domina las
 *     aprobaciones (sesgo del prompt o data raro en el grupo).
 *
 * Diseño defensivo:
 *  - Queries Postgres directas, no dependemos de métricas en memoria que se
 *    pierden con restart.
 *  - Deduplicación: si la misma alerta dispara N veces seguidas, solo se
 *    notifica la primera vez. Se "rearma" cuando la condición se resuelve
 *    o pasan 6h.
 *  - Si una query falla, loguea pero no rompe el cron — las otras alertas
 *    siguen ejecutándose.
 */

import prisma from './prisma';
import logger from './logger';
import { registrarAlerta } from './alertas';

// ─── Thresholds (tune-ables) ────────────────────────────────────────────────

// Alerta A: silencio sospechoso
const SILENCIO_VENTANA_HORAS = 6;
const SILENCIO_MENSAJES_MIN = 20;     // si >=20 mensajes en últimas 6h
const SILENCIO_APROBADOS_MAX = 0;     // y 0 reportes aprobados → alerta

// Alerta B: spike
const SPIKE_VENTANA_HORAS = 2;
const SPIKE_APROBADOS_MIN = 10;       // si >=10 aprobados en últimas 2h → alerta

// Alerta C: pendientes viejos
const PENDIENTE_ANTIGUEDAD_MIN = 60;  // pendientes >60min cuentan como "viejos"
const PENDIENTE_VIEJOS_MIN = 3;       // si hay >=3 pendientes viejos → alerta

// Alerta D: distribución sospechosa
const DISTRIB_VENTANA_DIAS = 7;
const DISTRIB_MIN_TOTAL = 10;         // solo evaluar si hay >=10 aprobados (sino ruido)
const DISTRIB_DOMINANCIA_PCT = 80;    // si un tipo concentra >=80% → alerta

// Cuánto tiempo dura el "lockout" de una alerta antes de permitir re-disparo
const ALERT_DEDUP_HORAS = 6;

// ─── Estado en memoria de últimas alertas (deduplicación) ───────────────────

type AlertaKey = 'silencio' | 'spike' | 'pendientes-viejos' | 'distribucion';
const ultimaAlerta = new Map<AlertaKey, number>();  // key → timestamp ms

function deboAlertar(key: AlertaKey): boolean {
  const ultima = ultimaAlerta.get(key);
  if (!ultima) return true;
  const haceMs = Date.now() - ultima;
  return haceMs >= ALERT_DEDUP_HORAS * 60 * 60 * 1000;
}

function marcarDisparada(key: AlertaKey): void {
  ultimaAlerta.set(key, Date.now());
}

function rearmarAlerta(key: AlertaKey): void {
  // La condición se resolvió → permitir nuevo disparo si vuelve a aparecer.
  ultimaAlerta.delete(key);
}

// ─── Queries de DB ──────────────────────────────────────────────────────────

async function contarMensajesDelGrupo(horas: number): Promise<number> {
  // Como NO persistimos cada mensaje del grupo (solo los que pasan filtros),
  // estimamos vía textosTotales del pipeline. Si la IA descartó por pre-filtro
  // léxico, dedup, o por no-relevante, igual cuenta como "mensaje recibido".
  //
  // Aproximación: contamos los reportes en cualquier estado registrados en la
  // ventana + estimación grosera. Es imperfecto pero suficiente para detectar
  // "0 actividad" vs "mucha actividad".
  const desde = new Date(Date.now() - horas * 60 * 60 * 1000);
  return prisma.reporte.count({
    where: { creadoEn: { gte: desde } },
  });
}

async function contarAprobadosRecientes(horas: number): Promise<number> {
  const desde = new Date(Date.now() - horas * 60 * 60 * 1000);
  return prisma.reporte.count({
    where: {
      aprobadoEn: { gte: desde },
      aprobadoPor: 'ai-auto',
    },
  });
}

async function contarPendientesViejos(antiguedadMin: number): Promise<number> {
  const limite = new Date(Date.now() - antiguedadMin * 60 * 1000);
  return prisma.reporte.count({
    where: {
      estado: 'pendiente',
      creadoEn: { lt: limite },
      framerIntentos: { lt: 5 },  // los con intentos>=5 son "muertos", no cuentan
    },
  });
}

interface DistribucionTipos {
  total: number;
  dominante: { tipo: string; cantidad: number; porcentaje: number } | null;
}

async function distribucionTiposRecientes(dias: number): Promise<DistribucionTipos> {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const grupos = await prisma.reporte.groupBy({
    by: ['tipoIncidente'],
    where: {
      aprobadoEn: { gte: desde },
      aprobadoPor: 'ai-auto',
    },
    _count: true,
  });

  const total = grupos.reduce((acc, g) => acc + g._count, 0);
  if (total === 0) return { total: 0, dominante: null };

  const top = grupos.reduce((max, g) => (g._count > max._count ? g : max));
  return {
    total,
    dominante: {
      tipo: top.tipoIncidente,
      cantidad: top._count,
      porcentaje: Math.round((top._count / total) * 100),
    },
  };
}

// ─── Lógica de cada alerta ──────────────────────────────────────────────────

async function chequearSilencio(): Promise<void> {
  try {
    const mensajes = await contarMensajesDelGrupo(SILENCIO_VENTANA_HORAS);
    const aprobados = await contarAprobadosRecientes(SILENCIO_VENTANA_HORAS);

    const condicion = mensajes >= SILENCIO_MENSAJES_MIN && aprobados <= SILENCIO_APROBADOS_MAX;

    logger.info(`[HealthAI] Silencio check: ${mensajes} mensajes / ${aprobados} aprobados últimas ${SILENCIO_VENTANA_HORAS}h. Condición: ${condicion}`);

    if (!condicion) {
      rearmarAlerta('silencio');
      return;
    }

    if (!deboAlertar('silencio')) return;

    await registrarAlerta({
      tipo: 'silencio',
      severidad: 'warn',
      mensaje:
        `⚠️ *Sistema Varone* — silencio sospechoso\n\n` +
        `Últimas ${SILENCIO_VENTANA_HORAS}h: ${mensajes} mensajes procesados, 0 aprobados por IA.\n\n` +
        `Posibles causas:\n` +
        `• Prompt demasiado restrictivo\n` +
        `• Gemini API degradada\n` +
        `• Grupo con baja actividad noticiosa\n\n` +
        `Revisar panel y logs.`,
      meta: { mensajes, aprobados, ventanaHoras: SILENCIO_VENTANA_HORAS },
    });
    marcarDisparada('silencio');
    logger.warn(`[HealthAI] ALERTA silencio disparada: ${mensajes} mensajes / 0 aprobados.`);
  } catch (e) {
    logger.error('[HealthAI] Error en chequearSilencio:', e);
  }
}

async function chequearSpike(): Promise<void> {
  try {
    const aprobados = await contarAprobadosRecientes(SPIKE_VENTANA_HORAS);
    const condicion = aprobados >= SPIKE_APROBADOS_MIN;

    logger.info(`[HealthAI] Spike check: ${aprobados} aprobados últimas ${SPIKE_VENTANA_HORAS}h. Condición: ${condicion}`);

    if (!condicion) {
      rearmarAlerta('spike');
      return;
    }

    if (!deboAlertar('spike')) return;

    await registrarAlerta({
      tipo: 'spike',
      severidad: 'warn',
      mensaje:
        `📈 *Sistema Varone* — spike de aprobaciones\n\n` +
        `${aprobados} reportes auto-aprobados en últimas ${SPIKE_VENTANA_HORAS}h.\n\n` +
        `Posibles causas:\n` +
        `• Incidente activo masivo en rutas\n` +
        `• Falso positivo masivo (revisar criterio del prompt)\n\n` +
        `Verificar tab "Listos para publicar" en el panel.`,
      meta: { aprobados, ventanaHoras: SPIKE_VENTANA_HORAS },
    });
    marcarDisparada('spike');
    logger.warn(`[HealthAI] ALERTA spike disparada: ${aprobados} aprobados.`);
  } catch (e) {
    logger.error('[HealthAI] Error en chequearSpike:', e);
  }
}

async function chequearPendientesViejos(): Promise<void> {
  try {
    const cantidad = await contarPendientesViejos(PENDIENTE_ANTIGUEDAD_MIN);
    const condicion = cantidad >= PENDIENTE_VIEJOS_MIN;

    logger.info(`[HealthAI] Pendientes viejos: ${cantidad} reportes >${PENDIENTE_ANTIGUEDAD_MIN}min sin avanzar. Condición: ${condicion}`);

    if (!condicion) {
      rearmarAlerta('pendientes-viejos');
      return;
    }

    if (!deboAlertar('pendientes-viejos')) return;

    await registrarAlerta({
      tipo: 'pendientes-viejos',
      severidad: 'warn',
      mensaje:
        `🔧 *Sistema Varone* — reportes colgados\n\n` +
        `${cantidad} reportes están en "pendiente" hace más de ${PENDIENTE_ANTIGUEDAD_MIN} minutos.\n\n` +
        `Posibles causas:\n` +
        `• Framer publisher caído (verificar :4001/health)\n` +
        `• Reportes sin URL que jamás se van a poder publicar\n` +
        `• Bug en cron de retry\n\n` +
        `Tab "Reintentando" en el panel.`,
      meta: { cantidad, antiguedadMin: PENDIENTE_ANTIGUEDAD_MIN },
    });
    marcarDisparada('pendientes-viejos');
    logger.warn(`[HealthAI] ALERTA pendientes-viejos disparada: ${cantidad} reportes.`);
  } catch (e) {
    logger.error('[HealthAI] Error en chequearPendientesViejos:', e);
  }
}

async function chequearDistribucion(): Promise<void> {
  try {
    const dist = await distribucionTiposRecientes(DISTRIB_VENTANA_DIAS);

    if (dist.total < DISTRIB_MIN_TOTAL) {
      // No hay suficiente data para evaluar — no es alerta ni rearma.
      logger.info(`[HealthAI] Distribución check: solo ${dist.total} aprobados últimos ${DISTRIB_VENTANA_DIAS}d (mínimo ${DISTRIB_MIN_TOTAL}). Skip.`);
      return;
    }

    const condicion = dist.dominante !== null && dist.dominante.porcentaje >= DISTRIB_DOMINANCIA_PCT;

    logger.info(`[HealthAI] Distribución: total=${dist.total}, dominante=${dist.dominante?.tipo}@${dist.dominante?.porcentaje}%. Condición: ${condicion}`);

    if (!condicion) {
      rearmarAlerta('distribucion');
      return;
    }

    if (!deboAlertar('distribucion')) return;

    await registrarAlerta({
      tipo: 'distribucion',
      severidad: 'warn',
      mensaje:
        `📊 *Sistema Varone* — distribución sospechosa\n\n` +
        `Últimos ${DISTRIB_VENTANA_DIAS} días: el tipo *${dist.dominante!.tipo}* representa ` +
        `${dist.dominante!.porcentaje}% de las ${dist.total} aprobaciones.\n\n` +
        `Posibles causas:\n` +
        `• Sesgo del prompt favoreciendo ese tipo\n` +
        `• Patrón real en el grupo (verificar)\n\n` +
        `Revisar reportes recientes en el panel.`,
      meta: {
        total: dist.total,
        tipoDominante: dist.dominante!.tipo,
        porcentaje: dist.dominante!.porcentaje,
        ventanaDias: DISTRIB_VENTANA_DIAS,
      },
    });
    marcarDisparada('distribucion');
    logger.warn(`[HealthAI] ALERTA distribución disparada: ${dist.dominante!.tipo}@${dist.dominante!.porcentaje}%.`);
  } catch (e) {
    logger.error('[HealthAI] Error en chequearDistribucion:', e);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Ejecuta los 4 chequeos en orden. Cada uno es independiente — si uno falla,
 * los otros siguen.
 */
export async function ejecutarChequeosIA(): Promise<void> {
  logger.info('[HealthAI] Ejecutando chequeos de comportamiento IA...');
  await chequearSilencio();
  await chequearSpike();
  await chequearPendientesViejos();
  await chequearDistribucion();
  logger.info('[HealthAI] Chequeos completados.');
}

/**
 * Ejecutado on-demand desde un endpoint de testing — fuerza alerta aunque
 * la condición no se cumpla. Útil para validar que las notif salen bien y
 * que aparecen en el panel.
 *
 * Se persiste como tipo='test' (no como el tipo real) para que sea fácil
 * filtrar/limpiar las alertas de prueba después.
 */
export async function dispararAlertaTest(key: AlertaKey): Promise<void> {
  ultimaAlerta.delete(key);  // reset dedup del tipo real
  const labels: Record<AlertaKey, string> = {
    'silencio': 'SILENCIO',
    'spike': 'SPIKE',
    'pendientes-viejos': 'PENDIENTES VIEJOS',
    'distribucion': 'DISTRIBUCIÓN',
  };
  await registrarAlerta({
    tipo: 'test',
    severidad: 'info',
    mensaje: `🧪 *Test* — alerta ${labels[key]}. Esto es prueba, ignorar.`,
    meta: { simula: key },
  });
}
