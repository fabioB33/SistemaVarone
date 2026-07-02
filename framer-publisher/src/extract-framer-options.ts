/**
 * Sprint mejoras-flujo (2026-06-30) — Extractor de opciones canonical del
 * form público de pirateriadecamiones.com.ar/formulario-de-incidentes.
 *
 * PROBLEMA QUE RESUELVE:
 *   Los enums en `src/config/enums-framer.ts` fueron redactados visualmente
 *   por Cowork observando el form. Puede haber drift entre lo que hay ahí y
 *   lo que el sitio realmente acepta. Si el desalineamiento pasa
 *   desapercibido:
 *     - La IA extrae valores no-canonical ("Cisterna", "Repuestos y
 *       Neumáticos") que la validación canonical del sprint anterior detecta,
 *       pero solo si el operador aprueba/edita — no en el flujo automático.
 *     - El publisher falla al postear porque el dropdown NO tiene la opción.
 *
 * QUÉ HACE:
 *   1. Reusa la sesión persistida del publisher (data/framer-session.json)
 *      + re-loguea si expiró usando el mismo patrón que form-filler.ts
 *      (así compartimos el flow de auth canónico, DRY).
 *   2. Navega al formulario público real.
 *   3. Por cada uno de los 10 SuperFields dropdowns, clickea el trigger,
 *      espera el popup scrollable, extrae las opciones textuales, cierra.
 *   4. Compara contra los enums locales en `src/config/enums-framer.ts` y
 *      reporta 3 categorías:
 *        - Opciones del sitio NO cubiertas por el enum (ADD)
 *        - Opciones del enum que YA NO existen en el sitio (REMOVE)
 *        - Opciones que matchean exacto (OK)
 *   5. Guarda un JSON con snapshot en `framer-real-options.json`.
 *
 * CÓMO CORRERLO:
 *   Local (con backend + publisher up):
 *     cd framer-publisher
 *     node --env-file=.env --import tsx src/extract-framer-options.ts
 *
 *   VPS (dentro del container del publisher):
 *     docker compose -f docker/docker-compose.prod.yml -p sistema-varone exec publisher \
 *       node --env-file=.env --import tsx src/extract-framer-options.ts
 *
 * CUÁNDO CORRERLO:
 *   - Después del primer deploy (para verificar que los enums matcheen la
 *     versión real del sitio en ese momento).
 *   - Cuando aparezca un reporte en `fallo_publicacion` con mensaje del tipo
 *     "No pude seleccionar 'X' en el dropdown 'Y'" — ejecutar para ver si
 *     alguna opción cambió en el sitio.
 *   - Cron trimestral / semestral como healthcheck preventivo.
 *
 * ADVERTENCIA:
 *   Los selectores del popup (`[id^="scrollable-superfields-"]`) son los
 *   mismos que usa el form-filler para postear. Si Framer cambia la
 *   arquitectura del componente SuperField, tanto este script como el
 *   publisher van a dejar de funcionar — se detectan al mismo tiempo.
 */

import { chromium, type Page, type BrowserContext } from 'playwright';
import { existsSync, writeFileSync } from 'fs';
import { relative } from 'path';

// Enums locales — parseados del archivo `../src/config/enums-framer.ts` en
// runtime para no crear una dependencia cross-package (el publisher tiene su
// propio tsconfig con rootDir aislado, no puede importar del backend). Como
// el archivo es un módulo TS con `export const NAME = [...]` predecible, el
// parser regex es robusto suficiente para el snapshot canónico.
import { readFileSync } from 'fs';

function parseEnum(source: string, name: string): string[] {
  // Match: export const NAME = [...] as const;
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`);
  const m = source.match(re);
  if (!m) throw new Error(`No se pudo parsear enum "${name}" desde enums-framer.ts`);
  const body = m[1];
  // Extract ALL string literals del cuerpo, tanto simple como doble quote.
  // Esto maneja tanto multi-line (['a',\n'b']) como single-line (['a', 'b']).
  const opts: string[] = [];
  const strRe = /['"]([^'"]*?)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = strRe.exec(body)) !== null) {
    opts.push(match[1]);
  }
  if (opts.length === 0) throw new Error(`Enum "${name}" parseado con 0 opciones`);
  return opts;
}

const ENUMS_SRC = readFileSync('../src/config/enums-framer.ts', 'utf-8');
const PROVINCIAS_AR = parseEnum(ENUMS_SRC, 'PROVINCIAS_AR');
const TIPOS_INCIDENTE_FRAMER = parseEnum(ENUMS_SRC, 'TIPOS_INCIDENTE_FRAMER');
const FUERZAS_INTERVINIENTES = parseEnum(ENUMS_SRC, 'FUERZAS_INTERVINIENTES');
const TIPOS_VEHICULO = parseEnum(ENUMS_SRC, 'TIPOS_VEHICULO');
const CARGAS_TRANSPORTADAS = parseEnum(ENUMS_SRC, 'CARGAS_TRANSPORTADAS');
const MODUS_OPERANDI = parseEnum(ENUMS_SRC, 'MODUS_OPERANDI');
const HUBO_VIOLENCIA = parseEnum(ENUMS_SRC, 'HUBO_VIOLENCIA');
const TIPOS_VEHICULO_INVOLUCRADO = parseEnum(ENUMS_SRC, 'TIPOS_VEHICULO_INVOLUCRADO');
const CANTIDADES_VEHICULOS = parseEnum(ENUMS_SRC, 'CANTIDADES_VEHICULOS');
const CANTIDADES_PERSONAS = parseEnum(ENUMS_SRC, 'CANTIDADES_PERSONAS');

// ─── Config ────────────────────────────────────────────────────────────
const SITIO_BASE = 'https://pirateriadecamiones.com.ar';
const RUTA_FORM = '/formulario-de-incidentes';
const RUTA_SIGNIN = '/sign-in';
const RUTA_ACCESS_DENIED = '/access-denied';
const STORAGE_PATH = process.env.FRAMER_STORAGE_STATE_PATH || './data/framer-session.json';
const EMAIL = process.env.FRAMER_SITE_EMAIL;
const PASSWORD = process.env.FRAMER_SITE_PASSWORD;
const NAV_TIMEOUT = 60_000;

if (!EMAIL || !PASSWORD) {
  console.error('❌ Falta FRAMER_SITE_EMAIL o FRAMER_SITE_PASSWORD en el .env');
  process.exit(1);
}

// ─── Mapeo label del sitio → enum canonical local ──────────────────────
// Cada entry: [labelExactoEnElSitio, enumLocal, keyEnJSON]
const DROPDOWN_MAPPING = [
  ['Provincia', PROVINCIAS_AR, 'provincia'],
  ['Tipo de Incidente', TIPOS_INCIDENTE_FRAMER, 'tipoIncidenteFramer'],
  ['Fuerza Interviniente', FUERZAS_INTERVINIENTES, 'fuerzaInterviniente'],
  ['Tipo de Vehículo', TIPOS_VEHICULO, 'tipoVehiculo'],
  ['Carga Transportada', CARGAS_TRANSPORTADAS, 'cargaTransportada'],
  ['Modus Operandi', MODUS_OPERANDI, 'modusOperandi'],
  ['¿Hubo violencia?', HUBO_VIOLENCIA, 'huboViolencia'],
  ['Tipo de Vehículo Involucrado', TIPOS_VEHICULO_INVOLUCRADO, 'tipoVehiculoInvolucrado'],
  ['Cantidad de Vehículos Involucrados', CANTIDADES_VEHICULOS, 'cantidadVehiculosInvolucrados'],
  ['Cantidad de Personas Involucradas', CANTIDADES_PERSONAS, 'cantidadPersonasInvolucradas'],
] as const;

// ─── Login canonical (copia del pattern de form-filler.ts) ─────────────
async function loginIfNeeded(page: Page, ctx: BrowserContext): Promise<void> {
  await page.goto(`${SITIO_BASE}${RUTA_FORM}`, {
    waitUntil: 'networkidle',
    timeout: NAV_TIMEOUT,
  });
  await page.waitForTimeout(1500);

  const url = page.url();
  if (!url.includes(RUTA_ACCESS_DENIED) && !url.includes(RUTA_SIGNIN)) {
    console.log('✅ Sesión persistida válida');
    return;
  }

  console.log('🔐 Sesión expirada, re-loguear...');
  await page.goto(`${SITIO_BASE}${RUTA_SIGNIN}`, {
    waitUntil: 'networkidle',
    timeout: NAV_TIMEOUT,
  });
  await page.locator('input[type="email"]').first().fill(EMAIL!);
  await page.locator('input[type="password"]').first().fill(PASSWORD!);
  await page.locator('input[type="submit"]').first().click();
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
  await page.waitForTimeout(2000);

  await page.goto(`${SITIO_BASE}${RUTA_FORM}`, {
    waitUntil: 'networkidle',
    timeout: NAV_TIMEOUT,
  });
  await page.waitForTimeout(2000);

  if (page.url().includes(RUTA_ACCESS_DENIED) || page.url().includes(RUTA_SIGNIN)) {
    throw new Error(`Login falló. URL final: ${page.url()}`);
  }

  await ctx.storageState({ path: STORAGE_PATH });
  console.log('✅ Sesión nueva guardada en', STORAGE_PATH);
}

// ─── Extraer opciones de un dropdown SuperField ────────────────────────
async function extraerOpciones(page: Page, label: string, index: number): Promise<string[]> {
  // Los SuperFields de Framer tienen esta estructura:
  //   <label>LABEL</label>
  //   ...
  //   <div class="framer-superfield-select">
  //     <input tabindex="-1"/>          ← el input NO recibe el click
  //     <div tabindex="0">              ← el div hermano abre el popup
  //   </div>
  //
  // Estrategia canonical: hay N dropdowns en el form en el ORDEN de nuestro
  // DROPDOWN_MAPPING. Los recorremos por posición (`nth-of-type`) para no
  // depender de matching de labels que se rompe con textos parciales.
  const clicked = await page.evaluate((idx) => {
    // Todos los div[tabindex="0"] visibles del form, en el orden del DOM
    const allTriggers = Array.from(document.querySelectorAll('div[tabindex="0"]')) as HTMLElement[];
    const visible = allTriggers.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const trigger = visible[idx];
    if (!trigger) return { ok: false, reason: `no hay dropdown en index ${idx} (total: ${visible.length})` };

    // Scroll hacia el trigger + click
    trigger.scrollIntoView({ block: 'center' });
    trigger.click();
    return { ok: true, total: visible.length };
  }, index);

  if (!clicked.ok) {
    console.log(`   ⚠ ${clicked.reason}`);
    return [];
  }

  await page.waitForTimeout(1500);

  // Extraer opciones del popup — pero solo del que se abrió AHORA (por eso
  // el timeout previo — asegura render completo)
  const opciones = await page.evaluate(() => {
    // El popup activo es el ÚLTIMO en el DOM con id que empieza con "scrollable-superfields-"
    const popups = Array.from(document.querySelectorAll('[id^="scrollable-superfields-"]'));
    if (popups.length === 0) return [];
    const popup = popups[popups.length - 1];
    const items = Array.from(popup.querySelectorAll('div'));
    const opts = items
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t.length > 0 && t.length < 100 && !t.includes('\n'));
    return Array.from(new Set(opts));
  });

  // Cerrar popup con Escape (2 veces por si el primero no cerró)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  return opciones;
}

// ─── Comparar contra enum local ────────────────────────────────────────
function diff(local: readonly string[], remote: string[]): {
  ok: string[];
  faltanEnLocal: string[]; // opciones del sitio que NO están en nuestro enum
  sobranEnLocal: string[]; // opciones del enum que YA NO están en el sitio
} {
  const ok: string[] = [];
  const faltanEnLocal: string[] = [];
  const sobranEnLocal: string[] = [];

  for (const opt of remote) {
    if (local.includes(opt)) {
      ok.push(opt);
    } else {
      faltanEnLocal.push(opt);
    }
  }
  for (const opt of local) {
    if (!remote.includes(opt)) {
      sobranEnLocal.push(opt);
    }
  }
  return { ok, faltanEnLocal, sobranEnLocal };
}

// ─── Main ──────────────────────────────────────────────────────────────
console.log('▶ Framer options extractor');
console.log('  URL:', `${SITIO_BASE}${RUTA_FORM}`);
console.log('  Session:', STORAGE_PATH);
console.log();

const browser = await chromium.launch({ headless: true });
const ctxOpts = existsSync(STORAGE_PATH) ? { storageState: STORAGE_PATH } : {};
const ctx = await browser.newContext({ ...ctxOpts, viewport: { width: 1400, height: 2400 } });
const page = await ctx.newPage();

try {
  await loginIfNeeded(page, ctx);
} catch (err) {
  console.error('❌ Login failed:', err instanceof Error ? err.message : err);
  await browser.close();
  process.exit(1);
}

console.log('\n▶ Extrayendo opciones de 10 dropdowns...\n');

const snapshot: Record<string, string[]> = {};
const report: Array<{
  campo: string;
  enum: string;
  siteCount: number;
  ok: number;
  addToLocal: string[];
  removeFromLocal: string[];
}> = [];

for (let i = 0; i < DROPDOWN_MAPPING.length; i++) {
  const [label, enumLocal, key] = DROPDOWN_MAPPING[i];
  const opts = await extraerOpciones(page, label, i);
  console.log(`   [${i}] "${label}" → ${opts.length} opciones`);

  snapshot[key] = opts;
  if (opts.length === 0) {
    console.log(`     ⚠ NO SE EXTRAJERON OPCIONES — dropdown puede haber cambiado su HTML`);
    continue;
  }

  const d = diff(enumLocal as readonly string[], opts);
  report.push({
    campo: key,
    enum: `TIPOS/CARGAS/etc (${enumLocal.length} local vs ${opts.length} site)`,
    siteCount: opts.length,
    ok: d.ok.length,
    addToLocal: d.faltanEnLocal,
    removeFromLocal: d.sobranEnLocal,
  });
}

await browser.close();

// ─── Reporte final ─────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  DIFF RESULTADO');
console.log('═══════════════════════════════════════════════════════════════');

let hayCambios = false;
for (const r of report) {
  if (r.addToLocal.length === 0 && r.removeFromLocal.length === 0) {
    console.log(`\n✅ ${r.campo}  (${r.ok}/${r.siteCount} matchean)`);
    continue;
  }
  hayCambios = true;
  console.log(`\n⚠  ${r.campo}  (${r.ok}/${r.siteCount} matchean)`);
  if (r.addToLocal.length > 0) {
    console.log(`   ┌─ AGREGAR al enum local (opciones del sitio faltantes):`);
    r.addToLocal.forEach((o) => console.log(`   │  + "${o}"`));
  }
  if (r.removeFromLocal.length > 0) {
    console.log(`   └─ QUITAR del enum local (ya no están en el sitio):`);
    r.removeFromLocal.forEach((o) => console.log(`      - "${o}"`));
  }
}

// Guardar snapshot completo
const outPath = './framer-real-options.json';
writeFileSync(outPath, JSON.stringify({ extractedAt: new Date().toISOString(), snapshot, report }, null, 2));
console.log(`\n📄 Snapshot + diff completo guardado en: ${relative(process.cwd(), outPath)}`);

if (hayCambios) {
  console.log('\n⚠  Hay drift entre enums locales y sitio. Editá src/config/enums-framer.ts');
  console.log('   con las opciones correctas y re-deployá.');
  process.exit(2); // exit != 0 para que CI/cron pueda alertar
} else {
  console.log('\n✅ Todos los enums locales están sincronizados con el sitio.');
}
