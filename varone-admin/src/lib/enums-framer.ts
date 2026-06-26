/**
 * Sprint pivot-framer-form (2026-06-26) — Espejo del backend
 * src/config/enums-framer.ts. Sincronizar a mano si cambian los enums.
 *
 * Los typos del origen están preservados (regla #1 SIN ATAJOS):
 *  - "Robo en grado de Tentantiva" (sic)
 *  - "Semaforos" (sin tilde)
 *  - "Privación Ilegitima de la Libertad" (sin tilde)
 *  - "Policia de la Ciudad Autonoma de Buenos Aires" (sin tildes)
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

export const TIPOS_INCIDENTE_FRAMER = [
  'Robo Total',
  'Robo Parcial',
  'Robo de Vehículo',
  'Robo de Semi',
  'Robo en grado de Tentantiva',
  'Lesiones',
  'Homicidio',
  'Privación Ilegitima de la Libertad',
  'Otro',
] as const;

export const FUERZAS_INTERVINIENTES = [
  'Policía Federal',
  'Policia de la Ciudad Autonoma de Buenos Aires',
  'Policia de la PBA',
  'Gendarmeria Nacional Argentina',
  'Prefectura Naval Argentina',
  'Policia de Seguridad Aeroportuaria',
  'Otro',
] as const;

export const TIPOS_VEHICULO = [
  'Camión más Acoplado',
  'Semirremolque',
  'Chasis más Acoplado',
  'Camioneta o Furgón',
  'Utilitario',
  'Otro',
] as const;

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

export const MODUS_OPERANDI = [
  'Carga y Descarga',
  'Cruzamientos',
  'Detención Eventual',
  'Semaforos',
  'Baja Velocidad',
  'Otros',
] as const;

export const HUBO_VIOLENCIA = ['Si', 'No'] as const;

export const TIPOS_VEHICULO_INVOLUCRADO = ['Auto', 'Moto', 'Otros'] as const;

export const CANTIDADES_VEHICULOS = ['1', '2', '3', 'Otros'] as const;

export const CANTIDADES_PERSONAS = ['1', '2', '3', '4', '5', 'Otros'] as const;

/**
 * Mapa nombre del campo (clave en el DB) → label legible para Varone +
 * lista de opciones canonical.
 */
export interface CampoFramerSpec {
  label: string;
  ayuda?: string;
  options: readonly string[];
}

export const CAMPOS_FRAMER_SPEC: Record<string, CampoFramerSpec> = {
  provincia: {
    label: 'Provincia',
    ayuda: 'Provincia argentina donde ocurrió el hecho.',
    options: PROVINCIAS_AR,
  },
  tipoIncidenteFramer: {
    label: 'Tipo de Incidente',
    options: TIPOS_INCIDENTE_FRAMER,
  },
  fuerzaInterviniente: {
    label: 'Fuerza Interviniente',
    ayuda: 'Solo si se menciona explícitamente.',
    options: FUERZAS_INTERVINIENTES,
  },
  tipoVehiculo: {
    label: 'Tipo de Vehículo',
    ayuda: 'Vehículo de carga afectado.',
    options: TIPOS_VEHICULO,
  },
  cargaTransportada: {
    label: 'Carga Transportada',
    options: CARGAS_TRANSPORTADAS,
  },
  modusOperandi: {
    label: 'Modus Operandi',
    options: MODUS_OPERANDI,
  },
  huboViolencia: {
    label: '¿Hubo violencia?',
    ayuda: 'Armas, golpes, amenazas físicas o retención del chofer.',
    options: HUBO_VIOLENCIA,
  },
  tipoVehiculoInvolucrado: {
    label: 'Tipo de Vehículo Involucrado',
    ayuda: 'Vehículo USADO por los delincuentes.',
    options: TIPOS_VEHICULO_INVOLUCRADO,
  },
  cantidadVehiculosInvolucrados: {
    label: 'Cantidad de Vehículos Involucrados',
    ayuda: 'Cantidad de vehículos de los delincuentes.',
    options: CANTIDADES_VEHICULOS,
  },
  cantidadPersonasInvolucradas: {
    label: 'Cantidad de Personas Involucradas',
    ayuda: 'Cantidad de delincuentes participantes.',
    options: CANTIDADES_PERSONAS,
  },
};

export const ORDEN_CAMPOS_FRAMER = [
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

export type CampoFramerKey = (typeof ORDEN_CAMPOS_FRAMER)[number];
