// Mensajes simulados de WhatsApp y noticias para testear el pipeline
// Mezcla de relevantes e irrelevantes para validar la clasificación de la IA

export const MENSAJES_WHATSAPP = [
  // --- RELEVANTES ---
  {
    id: 'wa-001',
    texto: 'ATENCIÓN!! Acaban de robar un camión con mercadería en la Ruta 9 a la altura de Campana, km 72. Tres sujetos armados interceptaron al chofer. Camión Scania blanco, patente AB 123 CD. Hace 20 minutos aprox.',
    esperado: true,
    descripcion: 'Robo de camión con datos completos',
  },
  {
    id: 'wa-002',
    texto: 'Ojo en autopista Rosario-Córdoba, hay un auto sospechoso parado en la banquina cerca del peaje de Carcarañá. Vidrios polarizados, están mirando los camiones que pasan. Cuidado muchachos.',
    esperado: true,
    descripcion: 'Alerta preventiva con ubicación',
  },
  {
    id: 'wa-003',
    texto: 'Anoche a las 23:30 le bloquearon el paso a un transportista en Ruta 34, zona de Rafaela. Le robaron toda la carga de electrodomésticos. El tipo está bien pero le llevaron todo.',
    esperado: true,
    descripcion: 'Robo de carga nocturno',
  },
  {
    id: 'wa-004',
    texto: 'URGENTE: Tentativa de robo en Ruta 5, km 150. Un camión frigorífico logró escapar. Los delincuentes iban en una camioneta Hilux negra. La policía ya está en la zona.',
    esperado: true,
    descripcion: 'Tentativa de robo frustrada',
  },
  {
    id: 'wa-005',
    texto: 'Corte total en Ruta 11 a la altura de Reconquista por piquete. No se puede pasar. Los camiones están quedando varados. Busquen ruta alternativa.',
    esperado: true,
    descripcion: 'Bloqueo vial que afecta transporte',
  },
  {
    id: 'wa-006',
    texto: 'Cuidado zona Panamericana ramal Escobar, hay un Peugeot 308 gris oscuro que viene siguiendo camiones hace rato. Se acercan, miran y se van. Ya avisé a la policía.',
    esperado: true,
    descripcion: 'Seguimiento sospechoso a camiones',
  },
  {
    id: 'wa-007',
    texto: 'Acabo de pasar por Ruta 7 km 200 y había un camión parado con la cabina abierta, el chofer dice que le sacaron todo hace una hora. Parece que le pusieron miguelitos para frenarlo.',
    esperado: true,
    descripcion: 'Robo con uso de miguelitos',
  },
  {
    id: 'wa-008',
    texto: 'Le tiraron piedras a un compañero en Ruta 3 cerca de Cañuelas. Le rompieron el parabrisas y cuando frenó le vaciaron el acoplado. Combustible, aceites, de todo se llevaron.',
    esperado: true,
    descripcion: 'Ataque con piedras y robo',
  },
  {
    id: 'wa-009',
    texto: 'Gendarmería montó un operativo en Ruta 14 a la altura de Gualeguaychú. Están parando todos los camiones y revisando documentación. Demora de 2 horas mínimo.',
    esperado: true,
    descripcion: 'Operativo policial en ruta',
  },
  {
    id: 'wa-010',
    texto: 'Emboscada en acceso a Rosario por Circunvalación. Un grupo paró un camión con carga de cereales a punta de pistola. Chofer golpeado. Se llevaron el camión completo, marca Volvo FH patente AC456DE.',
    esperado: true,
    descripcion: 'Emboscada con secuestro de camión',
  },

  // --- NO RELEVANTES ---
  {
    id: 'wa-011',
    texto: 'Buen día grupo! Alguien sabe dónde puedo cargar GNC barato por zona norte?',
    esperado: false,
    descripcion: 'Consulta personal no relevante',
  },
  {
    id: 'wa-012',
    texto: 'Feliz cumpleaños Carlos!! 🎂🎉 Que la pases genial crack',
    esperado: false,
    descripcion: 'Saludo de cumpleaños',
  },
  {
    id: 'wa-013',
    texto: 'Se vende Iveco Daily 2018, 120.000 km, cubiertas nuevas. Consultar por privado.',
    esperado: false,
    descripcion: 'Publicidad de venta de vehículo',
  },
  {
    id: 'wa-014',
    texto: 'jajajaja que bueno el video del accidente',
    esperado: false,
    descripcion: 'Mensaje trivial',
  },
  {
    id: 'wa-015',
    texto: 'Mañana hay asado en el galpón de Marcos, están todos invitados',
    esperado: false,
    descripcion: 'Evento social',
  },
  {
    id: 'wa-016',
    texto: 'Alguien tiene el contacto de un buen mecánico de caja ZF? La sexta no me entra.',
    esperado: false,
    descripcion: 'Consulta mecánica',
  },
  {
    id: 'wa-017',
    texto: 'El flete a Mendoza cuánto están cobrando? Necesito sacar 20 pallets.',
    esperado: false,
    descripcion: 'Consulta comercial de flete',
  },
  {
    id: 'wa-018',
    texto: 'Che cargué gasoil adulterado en la estación de la entrada de Pergamino. No carguen ahí!',
    esperado: false,
    descripcion: 'Queja sobre combustible (no seguridad)',
  },
  {
    id: 'wa-019',
    texto: 'Foto del atardecer en la ruta, hermoso día para viajar 🌅',
    esperado: false,
    descripcion: 'Mensaje casual con foto',
  },
  {
    id: 'wa-020',
    texto: 'Mi señora me dice que si hago otro viaje a Tucumán me deja jajaja',
    esperado: false,
    descripcion: 'Chiste personal',
  },
];

export const NOTICIAS_SIMULADAS = [
  // --- RELEVANTES ---
  {
    id: 'news-001',
    texto: `Piratas del asfalto robaron un camión cargado con electrónica en la Ruta 9
    Un camión que transportaba televisores y notebooks fue interceptado esta madrugada en la Ruta Nacional 9, a la altura del kilómetro 85, en la localidad de Zárate. Según informaron fuentes policiales, al menos cuatro delincuentes armados obligaron al conductor a detenerse utilizando un vehículo atravesado en la calzada. Los asaltantes redujeron al chofer y a su acompañante, y trasladaron la mercadería a dos camionetas. El hecho ocurrió alrededor de las 3:15 de la madrugada. La carga robada está valuada en aproximadamente 15 millones de pesos.`,
    esperado: true,
    descripcion: 'Noticia completa de robo de carga',
  },
  {
    id: 'news-002',
    texto: `Detuvieron a banda de piratas del asfalto que operaba en rutas del sur bonaerense
    Efectivos de la Policía Federal desarticularon una banda dedicada al robo de camiones en rutas de la provincia de Buenos Aires. Los detenidos, cinco hombres de entre 25 y 40 años, operaban principalmente en la Ruta 3 y la Ruta 226. Se les atribuyen al menos 8 asaltos a transportes de carga en los últimos tres meses.`,
    esperado: true,
    descripcion: 'Noticia de detención de banda',
  },
  {
    id: 'news-003',
    texto: `Crecen los asaltos a camiones en la autopista Buenos Aires-La Plata
    Transportistas denuncian un aumento del 40% en los robos de carga en el corredor Buenos Aires-La Plata durante el último trimestre. Las modalidades incluyen el uso de miguelitos, bloqueo con vehículos y encerronas en peajes. La Cámara de Transportistas exigió mayor presencia policial en la zona.`,
    esperado: true,
    descripcion: 'Informe sobre aumento de asaltos',
  },
  {
    id: 'news-004',
    texto: `Persecución en Ruta 8: policía recuperó un camión robado con carga de alimentos
    Tras una persecución de 15 kilómetros por la Ruta 8, efectivos de la Policía Bonaerense lograron recuperar un camión Mercedes-Benz Actros que había sido robado horas antes en Pergamino. El conductor del camión había sido dejado maniatado a la vera de la ruta. Dos sospechosos fueron detenidos.`,
    esperado: true,
    descripcion: 'Recuperación de camión robado',
  },

  // --- NO RELEVANTES ---
  {
    id: 'news-005',
    texto: `El gobierno anunció nuevas medidas para el sector agropecuario
    El Ministerio de Economía presentó ayer un paquete de medidas destinadas a impulsar la producción agropecuaria. Entre las principales novedades se destacan la reducción de retenciones para la soja y la implementación de créditos blandos para pequeños productores.`,
    esperado: false,
    descripcion: 'Noticia económica no relacionada',
  },
  {
    id: 'news-006',
    texto: `River Plate venció a Boca Juniors en un superclásico electrizante
    En una noche memorable en el Monumental, River se impuso 2-1 ante su clásico rival con goles de Borja y Solari. El descuento de Boca llegó en el tiempo de descuento a través de Cavani.`,
    esperado: false,
    descripcion: 'Noticia deportiva',
  },
  {
    id: 'news-007',
    texto: `Inauguraron nueva planta de tratamiento de agua en Tucumán
    El gobernador de Tucumán inauguró una moderna planta potabilizadora que abastecerá a más de 200.000 habitantes de la capital provincial. La obra demandó una inversión de 8.000 millones de pesos.`,
    esperado: false,
    descripcion: 'Noticia de infraestructura',
  },
  {
    id: 'news-008',
    texto: `Temporal de granizo causó serios daños en el norte de Córdoba
    Una fuerte tormenta con granizo afectó las localidades de Jesús María y Colonia Caroya dejando cuantiosos daños materiales. Se registraron techos volados, árboles caídos y cortes de energía eléctrica.`,
    esperado: false,
    descripcion: 'Noticia climática',
  },
];
