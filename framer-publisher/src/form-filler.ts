/**
 * Sprint pivot-framer-form (2026-06-26) — Form filler con Playwright.
 *
 * Postea un reporte al formulario público de pirateriadecamiones.com.ar.
 *
 * Flujo:
 *  1. Browser singleton + context con storageState persistido (cookies).
 *  2. Si la cookie sigue válida, navega directo a /formulario-de-incidentes.
 *  3. Si redirige a /access-denied o /sign-in → re-login automático con
 *     credenciales del env.
 *  4. Llenar 16 campos (3 text/date/time/textarea + 10 dropdowns + 1 file
 *     opcional + Nombre y Apellido hardcoded "Agente Pirateria de Camiones").
 *  5. Submit + verificar éxito.
 *
 * Estrategia para dropdowns SuperFields:
 *  - Cada dropdown tiene un sibling div[tabindex="0"] que abre el popup.
 *  - El popup renderea en un overlay #scrollable-superfields-*.
 *  - Para seleccionar opción: click en el trigger → click en el div con
 *    el texto exacto dentro del overlay.
 *
 * NO publica nada si faltan dropdowns obligatorios (validación previa
 * en el backend principal).
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SITIO_BASE = 'https://pirateriadecamiones.com.ar';
const RUTA_FORM = '/formulario-de-incidentes';
const RUTA_SIGNIN = '/sign-in';
const RUTA_ACCESS_DENIED = '/access-denied';

interface EnvConfig {
  email: string;
  password: string;
  storageStatePath: string;
  headless: boolean;
  navTimeout: number;
}

function getConfig(): EnvConfig {
  const email = process.env.FRAMER_SITE_EMAIL;
  const password = process.env.FRAMER_SITE_PASSWORD;
  if (!email || !password) {
    throw new Error('FRAMER_SITE_EMAIL y FRAMER_SITE_PASSWORD requeridos en el entorno.');
  }
  return {
    email,
    password,
    storageStatePath: process.env.FRAMER_STORAGE_STATE_PATH || './data/framer-session.json',
    headless: (process.env.FRAMER_HEADLESS ?? 'true').toLowerCase() !== 'false',
    navTimeout: parseInt(process.env.FRAMER_NAV_TIMEOUT_MS || '60000', 10),
  };
}

// ============================================================
// Browser singleton
// ============================================================

let browserSingleton: Browser | null = null;

async function getBrowser(headless: boolean): Promise<Browser> {
  if (!browserSingleton) {
    browserSingleton = await chromium.launch({ headless });
  }
  return browserSingleton;
}

export async function disconnectBrowser(): Promise<void> {
  if (browserSingleton) {
    await browserSingleton.close().catch(() => {});
    browserSingleton = null;
  }
}

// ============================================================
// Context con storage persistido
// ============================================================

async function getContext(cfg: EnvConfig): Promise<BrowserContext> {
  const browser = await getBrowser(cfg.headless);
  const storageState = existsSync(cfg.storageStatePath) ? cfg.storageStatePath : undefined;
  return browser.newContext({
    storageState,
    viewport: { width: 1400, height: 1800 },
  });
}

async function saveStorage(ctx: BrowserContext, path: string): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await ctx.storageState({ path });
}

// ============================================================
// Login
// ============================================================

async function loginIfNeeded(page: Page, cfg: EnvConfig): Promise<void> {
  // Navegar al form: si la sesión es válida, carga. Si no, redirige a /access-denied o /sign-in.
  await page.goto(`${SITIO_BASE}${RUTA_FORM}`, {
    waitUntil: 'networkidle',
    timeout: cfg.navTimeout,
  });
  await page.waitForTimeout(1500);

  const url = page.url();
  if (url.includes(RUTA_ACCESS_DENIED) || url.includes(RUTA_SIGNIN)) {
    console.log('[form-filler] sesión expirada, re-login...');
    await page.goto(`${SITIO_BASE}${RUTA_SIGNIN}`, {
      waitUntil: 'networkidle',
      timeout: cfg.navTimeout,
    });
    await page.locator('input[type="email"]').first().fill(cfg.email);
    await page.locator('input[type="password"]').first().fill(cfg.password);
    await page.locator('input[type="submit"]').first().click();

    // Espera por redirect post-login (home o el form si el sitio recuerda destino)
    await page.waitForLoadState('networkidle', { timeout: cfg.navTimeout });
    await page.waitForTimeout(2000);

    // Navegar al form ahora que estamos logueados
    await page.goto(`${SITIO_BASE}${RUTA_FORM}`, {
      waitUntil: 'networkidle',
      timeout: cfg.navTimeout,
    });
    await page.waitForTimeout(2000);

    if (page.url().includes(RUTA_ACCESS_DENIED) || page.url().includes(RUTA_SIGNIN)) {
      throw new Error(`Login falló: la sesión sigue inválida después de re-login (URL=${page.url()})`);
    }
  }
}

// ============================================================
// Dropdown selector helper
// ============================================================

async function selectDropdownOption(
  page: Page,
  fieldName: string,
  optionText: string,
): Promise<void> {
  // 1. Click en el trigger sibling del input
  const trigger = page.locator(`input[name="${fieldName}"]`).locator('xpath=../div[@tabindex="0"]').first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click({ force: true });
  await page.waitForTimeout(700);

  // 2. Click en la opción dentro del overlay scrollable
  // La opción es un div con el texto exacto, hijo del scrollable
  const optionLocator = page
    .locator('[id^="scrollable-superfields-"]')
    .locator(`text="${optionText}"`)
    .first();

  try {
    await optionLocator.waitFor({ state: 'visible', timeout: 5000 });
    await optionLocator.click({ force: true });
    await page.waitForTimeout(500);
  } catch (err) {
    // Fallback: click por evaluate buscando el div con texto exacto
    const clicked = await page.evaluate(({ name, text }) => {
      const scrollables = document.querySelectorAll('[id^="scrollable-superfields-"]');
      for (const s of scrollables) {
        const rect = (s as HTMLElement).getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;
        const all = s.querySelectorAll('*');
        for (const el of all) {
          if ((el as HTMLElement).textContent?.trim() === text && el.children.length === 0) {
            (el as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    }, { name: fieldName, text: optionText });
    if (!clicked) {
      throw new Error(`No pude seleccionar "${optionText}" en el dropdown "${fieldName}"`);
    }
    await page.waitForTimeout(500);
  }
}

// ============================================================
// Form filler — API pública
// ============================================================

export interface ReporteFormInput {
  nombreYApellido: string;
  fechaIncidente: string; // YYYY-MM-DD
  horaIncidente?: string | null; // HH:MM o null
  provincia: string;
  direccionLocalidad: string;
  tipoIncidenteFramer: string;
  fuerzaInterviniente: string;
  tipoVehiculo: string;
  cargaTransportada: string;
  modusOperandi: string;
  huboViolencia: string; // 'Si' | 'No'
  tipoVehiculoInvolucrado: string;
  cantidadVehiculosInvolucrados: string;
  cantidadPersonasInvolucradas: string;
  descripcionDelHecho?: string | null;
  // archivo adjunto futuro (Sprint+1)
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  /** URL final post-submit (puede ser /gracias / /reporte-enviado / etc.) */
  urlFinal?: string;
  /** Si el form muestra confirmación visible */
  mensajeConfirmacion?: string;
}

/**
 * Postea 1 reporte al formulario público.
 * Best-effort: si algo falla, retorna {ok: false, error}.
 */
export async function postearReporte(input: ReporteFormInput): Promise<SubmitResult> {
  const cfg = getConfig();
  const ctx = await getContext(cfg);
  const page = await ctx.newPage();

  try {
    await loginIfNeeded(page, cfg);

    console.log('[form-filler] llenando campos text/date/time...');

    // Campos básicos
    await page.locator('input[name="Nombre y Apellido"]').first().fill(input.nombreYApellido);
    await page.locator('input[name="Fecha del Incidente"]').first().fill(input.fechaIncidente);
    if (input.horaIncidente) {
      await page.locator('input[name="Hora del Incidente"]').first().fill(input.horaIncidente);
    }
    // Dirección/Localidad: el input visible tiene id="addr-*" + placeholder
    // "Dirección" (sin tilde en el campo aunque el label dice "Dirección").
    // Su `name` está vacío así que matcheamos por id^=addr- o por placeholder.
    await page
      .locator('input[id^="addr-"], input[placeholder="Dirección"]')
      .first()
      .fill(input.direccionLocalidad);

    console.log('[form-filler] seleccionando dropdowns...');

    await selectDropdownOption(page, 'Provincia', input.provincia);
    await selectDropdownOption(page, 'Tipo de Incidente', input.tipoIncidenteFramer);
    await selectDropdownOption(page, 'Fuerza Interviniente', input.fuerzaInterviniente);
    await selectDropdownOption(page, 'Tipo de Vehículo', input.tipoVehiculo);
    await selectDropdownOption(page, 'Carga Transportada', input.cargaTransportada);
    await selectDropdownOption(page, 'Modus Operandi', input.modusOperandi);
    await selectDropdownOption(page, '¿Hubo violencia?', input.huboViolencia);
    await selectDropdownOption(page, 'Tipo de Vehículo Involucrado', input.tipoVehiculoInvolucrado);
    await selectDropdownOption(
      page,
      'Cantidad de Vehículos Involucrados',
      input.cantidadVehiculosInvolucrados,
    );
    await selectDropdownOption(
      page,
      'Cantidad de Personas Involucradas',
      input.cantidadPersonasInvolucradas,
    );

    if (input.descripcionDelHecho) {
      await page
        .locator('textarea[name="Descripción del hecho"]')
        .first()
        .fill(input.descripcionDelHecho);
    }

    console.log('[form-filler] submit...');

    // Submit
    await page.locator('input[type="submit"][value="Enviar Reporte"], button:has-text("Enviar Reporte")').first().click();
    await page.waitForTimeout(4000);

    // Verificación de éxito (Sprint pivot-framer-form 2026-06-26 — confirmado
    // empíricamente con smoke real): el sitio NO redirige, queda en
    // /formulario-de-incidentes pero el body muestra "Reporte Enviado" como
    // confirmación visible.
    const urlFinal = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const bodyLower = bodyText.toLowerCase();
    const success =
      bodyLower.includes('reporte enviado') ||
      bodyLower.includes('reporte recibido') ||
      bodyLower.includes('enviado correctamente') ||
      bodyLower.includes('gracias por tu reporte') ||
      bodyLower.includes('gracias por su reporte') ||
      urlFinal.toLowerCase().includes('gracias') ||
      urlFinal.toLowerCase().includes('enviado');

    // Persistir cookies actualizadas
    await saveStorage(ctx, cfg.storageStatePath).catch(() => {});

    if (success) {
      return { ok: true, urlFinal, mensajeConfirmacion: bodyText.slice(0, 200) };
    } else {
      // Si no hay confirmación clara pero tampoco hubo error, retornar ok=false con caveat
      return {
        ok: false,
        error: 'No se detectó mensaje de confirmación post-submit.',
        urlFinal,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      urlFinal: page.url(),
    };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

/**
 * Health check: ¿está disponible el sitio? ¿la sesión sigue válida?
 */
export async function healthcheck(): Promise<{ alive: boolean; logged: boolean; error?: string }> {
  const cfg = getConfig();
  const ctx = await getContext(cfg);
  const page = await ctx.newPage();
  try {
    await page.goto(`${SITIO_BASE}${RUTA_FORM}`, {
      waitUntil: 'domcontentloaded',
      timeout: cfg.navTimeout,
    });
    await page.waitForTimeout(1500);
    const url = page.url();
    const logged = !url.includes(RUTA_ACCESS_DENIED) && !url.includes(RUTA_SIGNIN);
    return { alive: true, logged };
  } catch (err) {
    return {
      alive: false,
      logged: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}
