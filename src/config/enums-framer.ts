/**
 * Enums canonical del formulario público de Piratería de Camiones.
 *
 * Mapeo verificado empíricamente 2026-06-26 desde
 * https://pirateriadecamiones.com.ar/formulario-de-incidentes
 * (login + scraping del DOM con Playwright + click en cada dropdown).
 *
 * IMPORTANTE: estos strings tienen que coincidir LITERALMENTE con las
 * opciones del dropdown. Si Framer cambia una opción, el publisher rompe.
 * Hay test `inspect-form-options.test.ts` que cada N días re-scrapea para
 * detectar drift.
 */

export const PROVINCIAS_AR = [
  'Buenos Aires',
  'CABA',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const;

export type ProvinciaAR = (typeof PROVINCIAS_AR)[number];

export const TIPOS_INCIDENTE_FRAMER = [
  'Robo Total',
  'Robo Parcial',
  'Robo de Vehículo',
  'Robo de Semi',
  'Robo en grado de Tentantiva', // SIC: typo del form de origen, NO corregir
  'Lesiones',
  'Homicidio',
  'Privación Ilegitima de la Libertad', // SIC: sin tilde, NO corregir
  'Otro',
] as const;

export type TipoIncidenteFramer = (typeof TIPOS_INCIDENTE_FRAMER)[number];

export const FUERZAS_INTERVINIENTES = [
  'Policía Federal',
  'Policia de la Ciudad Autonoma de Buenos Aires', // SIC: sin tildes
  'Policia de la PBA',
  'Gendarmeria Nacional Argentina',
  'Prefectura Naval Argentina',
  'Policia de Seguridad Aeroportuaria',
  'Otro',
] as const;

export type FuerzaInterviniente = (typeof FUERZAS_INTERVINIENTES)[number];

export const TIPOS_VEHICULO = [
  'Camión más Acoplado',
  'Semirremolque',
  'Chasis más Acoplado',
  'Camioneta o Furgón',
  'Utilitario',
  'Otro',
] as const;

export type TipoVehiculo = (typeof TIPOS_VEHICULO)[number];

export const CARGAS_TRANSPORTADAS = [
  'Comestibles-Alimentos y Bebidas',
  'Electrodomésticos',
  'Paquetería',
  'Telefonía',
  'Cigarrillos',
  'Textil e Indumentaria',
  'Medicamentos',
  'Autopartes',
  'Otros',
] as const;

export type CargaTransportada = (typeof CARGAS_TRANSPORTADAS)[number];

export const MODUS_OPERANDI = [
  'Carga y Descarga',
  'Cruzamientos',
  'Detención Eventual',
  'Semaforos', // SIC: sin tilde
  'Baja Velocidad',
  'Otros',
] as const;

export type ModusOperandi = (typeof MODUS_OPERANDI)[number];

export const HUBO_VIOLENCIA = ['Si', 'No'] as const;
export type HuboViolencia = (typeof HUBO_VIOLENCIA)[number];

export const TIPOS_VEHICULO_INVOLUCRADO = ['Auto', 'Moto', 'Otros'] as const;
export type TipoVehiculoInvolucrado = (typeof TIPOS_VEHICULO_INVOLUCRADO)[number];

export const CANTIDADES_VEHICULOS = ['1', '2', '3', 'Otros'] as const;
export type CantidadVehiculos = (typeof CANTIDADES_VEHICULOS)[number];

export const CANTIDADES_PERSONAS = ['1', '2', '3', '4', '5', 'Otros'] as const;
export type CantidadPersonas = (typeof CANTIDADES_PERSONAS)[number];

/**
 * Lista de TODOS los campos que la IA tiene que extraer y que pueden
 * quedar marcados como "ambigüedad" si no logra elegir.
 */
export const CAMPOS_DROPDOWN_FRAMER = [
  'provincia',
  'tipoIncidenteFramer',
  'fuerzaInterviniente',
  'tipoVehiculo',
  'cargaTransportada',
  'modusOperandi',
  'huboViolencia',
  'tipoVehiculoInvolucrado',
  'cantidadVehiculosInvolucrados',
  'cantidadPersonasInvolucradas',
] as const;

export type CampoDropdownFramer = (typeof CAMPOS_DROPDOWN_FRAMER)[number];

/**
 * Nombre fijo del agente cuando el sistema reporta de forma automática.
 * (Regla #9 NO-HARDCODED — vive acá, no en código de runtime).
 */
export const NOMBRE_AGENTE_REPORTE = 'Agente Pirateria de Camiones';
