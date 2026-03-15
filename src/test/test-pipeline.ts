import dotenv from 'dotenv';
dotenv.config();

import { analizarConIA } from '../services/ia';
import { MENSAJES_WHATSAPP, NOTICIAS_SIMULADAS } from './mensajes-simulados';

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMARILLO = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface ResultadoTest {
  id: string;
  descripcion: string;
  esperado: boolean;
  obtenido: boolean;
  correcto: boolean;
  reporte: Record<string, unknown> | null;
  tiempoMs: number;
}

async function testearMensaje(msg: { id: string; texto: string; esperado: boolean; descripcion: string }): Promise<ResultadoTest> {
  const inicio = Date.now();

  try {
    const resultado = await analizarConIA(msg.texto);
    const tiempoMs = Date.now() - inicio;

    return {
      id: msg.id,
      descripcion: msg.descripcion,
      esperado: msg.esperado,
      obtenido: resultado.esRelevante,
      correcto: resultado.esRelevante === msg.esperado,
      reporte: resultado.reporte as unknown as Record<string, unknown>,
      tiempoMs,
    };
  } catch (error) {
    return {
      id: msg.id,
      descripcion: msg.descripcion,
      esperado: msg.esperado,
      obtenido: false,
      correcto: false,
      reporte: null,
      tiempoMs: Date.now() - inicio,
    };
  }
}

function imprimirResultado(r: ResultadoTest): void {
  const icono = r.correcto ? `${VERDE}✓${RESET}` : `${ROJO}✗${RESET}`;
  const esperadoTxt = r.esperado ? 'relevante' : 'no relevante';
  const obtenidoTxt = r.obtenido ? 'relevante' : 'no relevante';

  console.log(`  ${icono} ${BOLD}${r.id}${RESET} - ${r.descripcion}`);
  console.log(`    Esperado: ${esperadoTxt} | Obtenido: ${obtenidoTxt} | ${r.tiempoMs}ms`);

  if (r.reporte) {
    console.log(`    ${CYAN}→ ${r.reporte.tipoIncidente} | ${r.reporte.ubicacion} | ${r.reporte.fecha}${RESET}`);
  }

  if (!r.correcto) {
    console.log(`    ${ROJO}⚠ CLASIFICACIÓN INCORRECTA${RESET}`);
  }

  console.log('');
}

async function ejecutarTests(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`${BOLD}  SISTEMA VARONE - Test del Pipeline IA${RESET}`);
  console.log('='.repeat(60));

  const provider = process.env.AI_PROVIDER || 'gemini';
  console.log(`\n  Proveedor IA: ${CYAN}${provider}${RESET}\n`);

  // Verificar API key
  if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
    console.error(`${ROJO}ERROR: GEMINI_API_KEY no configurada en .env${RESET}`);
    process.exit(1);
  }
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error(`${ROJO}ERROR: OPENAI_API_KEY no configurada en .env${RESET}`);
    process.exit(1);
  }

  const todosLosMensajes = [
    ...MENSAJES_WHATSAPP.map((m) => ({ ...m, grupo: 'WhatsApp' })),
    ...NOTICIAS_SIMULADAS.map((m) => ({ ...m, grupo: 'Noticias' })),
  ];

  const resultados: ResultadoTest[] = [];

  // --- Test WhatsApp ---
  console.log(`${BOLD}${AMARILLO}▸ Mensajes de WhatsApp (${MENSAJES_WHATSAPP.length})${RESET}\n`);
  for (const msg of MENSAJES_WHATSAPP) {
    const resultado = await testearMensaje(msg);
    resultados.push(resultado);
    imprimirResultado(resultado);
  }

  // --- Test Noticias ---
  console.log(`${BOLD}${AMARILLO}▸ Noticias scrapeadas (${NOTICIAS_SIMULADAS.length})${RESET}\n`);
  for (const msg of NOTICIAS_SIMULADAS) {
    const resultado = await testearMensaje(msg);
    resultados.push(resultado);
    imprimirResultado(resultado);
  }

  // --- Test Duplicados ---
  console.log(`${BOLD}${AMARILLO}▸ Test de consistencia (mismo mensaje 2 veces)${RESET}\n`);
  const msgDuplicado = MENSAJES_WHATSAPP[0];
  const r1 = await testearMensaje(msgDuplicado);
  const r2 = await testearMensaje(msgDuplicado);
  const mismaClasificacion = r1.obtenido === r2.obtenido;
  const iconoDup = mismaClasificacion ? `${VERDE}✓${RESET}` : `${ROJO}✗${RESET}`;
  console.log(`  ${iconoDup} Mismo mensaje procesado 2 veces → ${mismaClasificacion ? 'Consistente' : 'INCONSISTENTE'}\n`);

  // --- Resumen ---
  const correctos = resultados.filter((r) => r.correcto).length;
  const total = resultados.length;
  const porcentaje = ((correctos / total) * 100).toFixed(1);
  const tiempoPromedio = Math.round(resultados.reduce((sum, r) => sum + r.tiempoMs, 0) / total);

  console.log('='.repeat(60));
  console.log(`${BOLD}  RESUMEN${RESET}`);
  console.log('='.repeat(60));
  console.log(`  Correctos:      ${correctos}/${total} (${porcentaje}%)`);
  console.log(`  Tiempo promedio: ${tiempoPromedio}ms por mensaje`);

  const fallos = resultados.filter((r) => !r.correcto);
  if (fallos.length > 0) {
    console.log(`\n  ${ROJO}Fallos:${RESET}`);
    fallos.forEach((f) => console.log(`    - ${f.id}: esperaba "${f.esperado ? 'relevante' : 'no relevante'}", obtuvo "${f.obtenido ? 'relevante' : 'no relevante'}"`));
  }

  console.log('\n' + '='.repeat(60) + '\n');

  process.exit(fallos.length > 0 ? 1 : 0);
}

ejecutarTests().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
