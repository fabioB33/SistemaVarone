import { analizarConIA } from './ia';
import { existeDuplicado, registrarReporte } from './dedup';
import { enviarAFramer } from './framer';

/**
 * Pipeline principal:
 * 1. Recibe texto crudo (de WA o scraper)
 * 2. Lo envía a la IA para clasificar y estructurar
 * 3. Verifica duplicados en PostgreSQL
 * 4. Si es nuevo, lo registra y lo envía a Framer
 */
export async function procesarTexto(
  texto: string,
  fuente: 'whatsapp' | 'scraping',
  urlNoticia?: string
): Promise<void> {
  // Ignorar mensajes muy cortos
  if (texto.trim().length < 15) return;

  try {
    // Paso 1: Análisis con IA
    const resultado = await analizarConIA(texto);

    if (!resultado.esRelevante || !resultado.reporte) {
      console.log(`[Pipeline] Texto descartado (no relevante) - fuente: ${fuente}`);
      return;
    }

    const reporte = resultado.reporte;
    reporte.fuente = fuente;
    reporte.textoOriginal = texto;
    if (urlNoticia) reporte.urlNoticia = urlNoticia;

    // Paso 2: Verificar duplicados
    const esDuplicado = await existeDuplicado(texto);
    if (esDuplicado) {
      console.log(`[Pipeline] Duplicado detectado, ignorando.`);
      return;
    }

    // Paso 3: Registrar en DB
    await registrarReporte(texto, reporte as unknown as Record<string, unknown>);

    // Paso 4: Enviar a Framer
    await enviarAFramer(reporte);

    console.log(`[Pipeline] Procesado: ${reporte.tipoIncidente} en ${reporte.ubicacion} (${fuente})`);
  } catch (error) {
    console.error(`[Pipeline] Error procesando texto (${fuente}):`, error);
  }
}
