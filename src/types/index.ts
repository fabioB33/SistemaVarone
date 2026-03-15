// Reporte estructurado que devuelve la IA
export interface ReporteIncidente {
  fecha: string;
  hora: string;
  ubicacion: string;
  ruta: string;
  tipoIncidente: string;
  descripcion: string;
  vehiculo?: string;
  patente?: string;
  fuente: 'whatsapp' | 'scraping';
  urlNoticia?: string;
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

// Noticia cruda del scraper
export interface NoticiaCruda {
  titulo: string;
  contenido: string;
  url: string;
  portal: string;
  fechaPublicacion?: string;
}

// Configuración de un portal para scraping
export interface PortalConfig {
  nombre: string;
  url: string;
  baseUrl?: string;
  selectores: {
    listado: string;
    titulo: string;
    contenido: string;
    fecha?: string;
    link: string;
  };
}

// Respuesta de la IA
export interface RespuestaIA {
  esRelevante: boolean;
  reporte: ReporteIncidente | null;
}
