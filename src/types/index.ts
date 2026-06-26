// Reporte estructurado que devuelve la IA
export interface ReporteIncidente {
  fecha: string;
  hora: string;
  ubicacion: string;
  ruta: string;
  tipoIncidente: string;
  gravedad?: string;
  descripcion: string;
  vehiculo?: string;
  patente?: string;
  victimas?: string;
  detenidos?: string;
  fuente: 'whatsapp';
  urlNoticia?: string;
  portalOrigen?: string;
  textoOriginal: string;

  // Sprint pivot-framer-form (2026-06-26) — campos del formulario público.
  // La IA devuelve cada uno con un valor de los enums canonical o null si
  // no logra decidir (señal de ambigüedad). Validación fuzzy contra enums
  // en `enum-matcher.ts`.
  provincia?: string | null;
  tipoIncidenteFramer?: string | null;
  fuerzaInterviniente?: string | null;
  tipoVehiculo?: string | null;
  cargaTransportada?: string | null;
  modusOperandi?: string | null;
  huboViolencia?: string | null;
  tipoVehiculoInvolucrado?: string | null;
  cantidadVehiculosInvolucrados?: string | null;
  cantidadPersonasInvolucradas?: string | null;
}

// Mensaje crudo de WhatsApp
export interface MensajeWhatsApp {
  id: string;
  from: string;
  body: string;
  timestamp: number;
  groupName: string;
}

// Respuesta de la IA
export interface RespuestaIA {
  esRelevante: boolean;
  reporte: ReporteIncidente | null;
}
