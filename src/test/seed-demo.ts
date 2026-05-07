import crypto from 'crypto';
import prisma from '../services/prisma';

// Seed de respaldo para demo: 8 reportes en distintos estados, todos
// con datos realistas de piratería del asfalto en rutas argentinas.
// Si el flujo en vivo no llega a tiempo, esto deja el panel poblado.

interface SeedReporte {
  fuente: 'whatsapp';
  fecha: string;
  hora?: string;
  ubicacion: string;
  ruta: string;
  tipoIncidente: string;
  gravedad?: string;
  descripcion: string;
  textoOriginal: string;
  vehiculo?: string;
  patente?: string;
  victimas?: string;
  detenidos?: string;
  urlNoticia?: string;
  estado: 'pendiente' | 'aprobado' | 'publicado' | 'descartado';
}

function hash(texto: string): string {
  return crypto.createHash('sha256').update(texto.trim().toLowerCase()).digest('hex');
}

const HOY = new Date().toISOString().slice(0, 10);
const AYER = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const ANTEAYER = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

const REPORTES: SeedReporte[] = [
  {
    fuente: 'whatsapp',
    fecha: HOY,
    hora: '04:30',
    ubicacion: 'González Catán',
    ruta: 'Ruta 3 km 32',
    tipoIncidente: 'robo_de_carga',
    gravedad: 'alta',
    descripcion: 'Banda armada interceptó camión con mercadería electrónica. Chofer reducido sin heridos. Carga total robada.',
    textoOriginal: 'Aviso urgente: acaban de asaltar un camión en Ruta 3 km 32 a la altura de González Catán. Banda armada, 4 personas. Se llevaron mercadería electrónica completa. Chofer ileso pero shockeado. Hace 20 minutos.',
    vehiculo: 'Mercedes-Benz Actros, semirremolque',
    patente: 'AE 432 KP',
    victimas: 'Chofer ileso, en shock',
    estado: 'pendiente',
  },
  {
    fuente: 'whatsapp',
    fecha: HOY,
    hora: '02:15',
    ubicacion: 'San Justo',
    ruta: 'Autopista Riccheri',
    tipoIncidente: 'asalto',
    gravedad: 'media',
    descripcion: 'Tentativa de asalto a fletero en zona de peaje. Conductor logró acelerar y escapar. Reportado a la 911.',
    textoOriginal: 'Compañeros, atención en Riccheri zona peaje San Justo. Anoche 2am quisieron parar a un fletero, salió zafando. Dos motos, encapuchados.',
    vehiculo: 'Iveco Daily',
    estado: 'pendiente',
  },
  {
    fuente: 'whatsapp',
    fecha: HOY,
    hora: '06:00',
    ubicacion: 'La Matanza',
    ruta: 'Ruta 21',
    tipoIncidente: 'bloqueo',
    gravedad: 'media',
    descripcion: 'Bloqueo con vehículos cruzados a la altura del km 8. Posible maniobra para asalto. Se recomienda desvío por Camino de Cintura.',
    textoOriginal: 'OJO Ruta 21 km 8 La Matanza, bloqueo con dos autos cruzados, no pasen, parece pirateria. Desvíen por Camino de Cintura.',
    estado: 'pendiente',
  },
  {
    fuente: 'whatsapp',
    fecha: AYER,
    hora: '23:45',
    ubicacion: 'Florencio Varela',
    ruta: 'Ruta 53',
    tipoIncidente: 'robo_de_carga',
    gravedad: 'alta',
    descripcion: 'Robo de camión con carga de electrodomésticos. La banda se llevó el vehículo completo. Recuperado vacío en Quilmes a las 4 AM.',
    textoOriginal: 'Ayer a la noche robaron un camión con electrodomésticos en Ruta 53 Florencio Varela. Apareció vacío esta mañana en Quilmes. Patente: AC 215 LM.',
    vehiculo: 'Scania R450',
    patente: 'AC 215 LM',
    detenidos: 'Sin detenidos hasta el momento',
    estado: 'aprobado',
    urlNoticia: 'https://www.cronica.com.ar/policiales/robo-camion-florencio-varela',
  },
  {
    fuente: 'whatsapp',
    fecha: AYER,
    hora: '15:20',
    ubicacion: 'Tigre',
    ruta: 'Panamericana ramal Tigre',
    tipoIncidente: 'tentativa',
    gravedad: 'baja',
    descripcion: 'Tentativa de asalto a camión cisterna. Banda huyó al ver patrullero policial cercano. Sin daños.',
    textoOriginal: 'Tentativa hoy 3pm en Panamericana ramal Tigre, intentaron parar un cisterna pero pasó la cana y rajaron. Camionero está bien.',
    vehiculo: 'Camión cisterna',
    estado: 'aprobado',
  },
  {
    fuente: 'whatsapp',
    fecha: ANTEAYER,
    hora: '03:00',
    ubicacion: 'Cañuelas',
    ruta: 'Autopista Ezeiza-Cañuelas',
    tipoIncidente: 'robo_de_carga',
    gravedad: 'alta',
    descripcion: 'Asalto a camión transportando carne. Banda de 5 personas armadas. Se llevaron 12 toneladas de mercadería. Detenidos 2 sospechosos.',
    textoOriginal: 'Asalto carga de carne en Ezeiza-Cañuelas, banda de 5 con armas largas. 12 toneladas. La policía agarró 2 esta mañana en allanamiento.',
    vehiculo: 'Volvo FH16, semi térmico',
    patente: 'AD 998 RT',
    detenidos: '2 detenidos en allanamiento posterior',
    estado: 'publicado',
    urlNoticia: 'https://www.infobae.com/policiales/asalto-canuelas-carga-carne',
  },
  {
    fuente: 'whatsapp',
    fecha: ANTEAYER,
    hora: '09:30',
    ubicacion: 'José C. Paz',
    ruta: 'Ruta 8 km 35',
    tipoIncidente: 'asalto',
    gravedad: 'media',
    descripcion: 'Asalto a chofer de aplicación de transporte. Le robaron pertenencias personales y dinero. Sin lesiones graves.',
    textoOriginal: 'Asaltaron a un Cabify en Ruta 8 km 35 José C. Paz. Le sacaron plata y celular pero el chofer está bien.',
    vehiculo: 'Toyota Corolla blanco',
    estado: 'publicado',
  },
  {
    fuente: 'whatsapp',
    fecha: ANTEAYER,
    hora: '12:00',
    ubicacion: 'Mar del Plata',
    ruta: 'Ruta 2',
    tipoIncidente: 'asalto',
    gravedad: 'baja',
    descripcion: 'Reporte sin verificar de bloqueo en Ruta 2. Se confirmó posteriormente que era operativo policial de control vehicular.',
    textoOriginal: 'Ojo Ruta 2 altura Mar del Plata, dicen que hay piratería',
    estado: 'descartado',
  },
];

async function main() {
  console.log('[Seed] Limpiando datos previos...');
  await prisma.reporte.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.resumenDiario.deleteMany();

  console.log(`[Seed] Insertando ${REPORTES.length} reportes...`);

  for (const r of REPORTES) {
    await prisma.reporte.create({
      data: {
        hash: hash(r.textoOriginal),
        fuente: r.fuente,
        fecha: r.fecha,
        hora: r.hora ?? null,
        ubicacion: r.ubicacion,
        ruta: r.ruta,
        tipoIncidente: r.tipoIncidente,
        gravedad: r.gravedad ?? null,
        descripcion: r.descripcion,
        textoOriginal: r.textoOriginal,
        vehiculo: r.vehiculo ?? null,
        patente: r.patente ?? null,
        victimas: r.victimas ?? null,
        detenidos: r.detenidos ?? null,
        urlNoticia: r.urlNoticia ?? null,
        estado: r.estado,
        framerEnviado: r.estado === 'publicado',
        aprobadoPor: r.estado !== 'pendiente' ? 'varone' : null,
        aprobadoEn: r.estado !== 'pendiente' ? new Date() : null,
        framerItemId: r.estado === 'publicado' ? `seed_item_${Math.random().toString(36).slice(2, 10)}` : null,
        framerSlug: r.estado === 'publicado' ? r.descripcion.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) : null,
      },
    });
  }

  const counts = await prisma.reporte.groupBy({
    by: ['estado'],
    _count: true,
  });

  console.log('[Seed] Listo. Conteo por estado:');
  for (const c of counts) {
    console.log(`  ${c.estado}: ${c._count}`);
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('[Seed] Error:', e);
  process.exit(1);
});
