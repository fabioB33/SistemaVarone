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
  portalOrigen?: string;  // medio del que viene la URL si el mensaje WA contenía un link (ej: "infobae.com")
  textoOriginal: string;
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
