-- Sprint demo-readiness (2026-06-30): seed para mostrar a Varone con data viva.
-- 5 reportes nuevos hoy distribuidos por estado + ubicación + fuente + tipo.
-- También geocodea las ubicaciones nuevas que no estén en la tabla geocoded.

-- Limpiar reportes viejos para que la demo sea limpia
DELETE FROM audit_log WHERE reporte_id IS NOT NULL;
DELETE FROM reportes;
DELETE FROM scrapes_descartados;

-- Demo Reporte 1: PENDIENTE con faltantes (Tartagal-like falso positivo, pero
-- evitamos blacklist trigger; lo dejamos como caso de borde "Varone tiene
-- que decidir"). Reporte WhatsApp normal con 2 dropdowns faltantes.
INSERT INTO reportes (
  hash, fuente, fecha, hora, ubicacion, ruta, tipo_incidente, gravedad,
  descripcion, texto_original, framer_enviado, framer_intentos, estado,
  provincia, tipo_incidente_framer, fuerza_interviniente,
  tipo_vehiculo, carga_transportada, modus_operandi, hubo_violencia,
  tipo_vehiculo_involucrado, cantidad_vehiculos_involucrados, cantidad_personas_involucradas,
  campos_faltantes, creado_en
) VALUES (
  'demo-seed-001',
  'whatsapp', CURRENT_DATE::text, '14:30',
  'Acceso Sudeste km 12', 'Acceso Sudeste km 12',
  'robo_de_carga', 'alta',
  'Asalto a camión con carga de electrodomésticos en Acceso Sudeste km 12. Dos personas armadas interceptaron al chofer. Carga total robada. Chofer ileso.',
  '[REPORTE WHATSAPP] Asalto camión Acceso Sudeste km 12 hace 30 min. Electrodomésticos. 2 motochorros armados. Chofer OK.',
  false, 0, 'pendiente',
  'Buenos Aires', 'Robo Total', 'Policia de la PBA',
  NULL, 'Electrodomésticos', NULL,
  'Si', 'Moto', '1', '2',
  ARRAY['tipoVehiculo', 'modusOperandi'],
  NOW() - INTERVAL '3 hours'
);

-- Demo Reporte 2: PENDIENTE sin faltantes (puede aprobar con 1 click)
INSERT INTO reportes (
  hash, fuente, fecha, hora, ubicacion, ruta, tipo_incidente, gravedad,
  descripcion, texto_original, framer_enviado, framer_intentos, estado,
  provincia, tipo_incidente_framer, fuerza_interviniente,
  tipo_vehiculo, carga_transportada, modus_operandi, hubo_violencia,
  tipo_vehiculo_involucrado, cantidad_vehiculos_involucrados, cantidad_personas_involucradas,
  campos_faltantes, portal_origen, titulo_original, url_noticia, creado_en
) VALUES (
  'demo-seed-002',
  'scraping', CURRENT_DATE::text, '08:15',
  'Panamericana km 45 ramal Pilar', 'Panamericana km 45 ramal Pilar',
  'asalto', 'alta',
  'Piratas del asfalto interceptaron un trailer con neumáticos en la Panamericana. Tres delincuentes armados, chofer hospitalizado con golpes. Policía Bonaerense en el lugar.',
  '[CLARIN] Piratas del asfalto asaltaron a un trailer en Panamericana km 45 ramal Pilar. Chofer hospitalizado.',
  false, 0, 'pendiente',
  'Buenos Aires', 'Robo Total', 'Policia de la PBA',
  'Camión más Acoplado', 'Autopartes', 'Carga y Descarga',
  'Si', 'Auto', '1', '3',
  ARRAY[]::text[], 'clarin', 'Piratas del asfalto asaltaron a un trailer en Panamericana km 45',
  'https://www.clarin.com/policiales/piratas-asfalto-panamericana-km-45.html',
  NOW() - INTERVAL '1 hour 30 minutes'
);

-- Demo Reporte 3: APROBADO ya por Varone (espera publisher)
INSERT INTO reportes (
  hash, fuente, fecha, hora, ubicacion, ruta, tipo_incidente, gravedad,
  descripcion, texto_original, framer_enviado, framer_intentos, estado,
  provincia, tipo_incidente_framer, fuerza_interviniente,
  tipo_vehiculo, carga_transportada, modus_operandi, hubo_violencia,
  tipo_vehiculo_involucrado, cantidad_vehiculos_involucrados, cantidad_personas_involucradas,
  campos_faltantes, portal_origen, titulo_original, url_noticia, aprobado_por, aprobado_en, creado_en
) VALUES (
  'demo-seed-003',
  'scraping', CURRENT_DATE::text, '11:00',
  'RN 9 km 80', 'RN 9 km 80',
  'robo_de_carga', 'media',
  'Robo de carga de comestibles en Ruta Nacional 9 km 80. Camión cisterna abandonado tras el asalto.',
  '[LA NACION] Robo de carga RN 9 km 80, cisterna abandonada.',
  false, 0, 'aprobado',
  'Buenos Aires', 'Robo Total', 'Policia Federal Argentina',
  'Semirremolque', 'Comestibles-Alimentos y Bebidas', 'Detención Eventual',
  'No', 'Auto', '1', '2',
  ARRAY[]::text[], 'la-nacion', 'Robaron carga de comestibles en Ruta 9 km 80',
  'https://www.lanacion.com.ar/seguridad/robo-carga-rn9-km80.html',
  'varone', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '2 hours'
);

-- Demo Reporte 4: PUBLICADO (ya en el sitio público)
INSERT INTO reportes (
  hash, fuente, fecha, hora, ubicacion, ruta, tipo_incidente, gravedad,
  descripcion, texto_original, framer_enviado, framer_intentos, estado,
  provincia, tipo_incidente_framer, fuerza_interviniente,
  tipo_vehiculo, carga_transportada, modus_operandi, hubo_violencia,
  tipo_vehiculo_involucrado, cantidad_vehiculos_involucrados, cantidad_personas_involucradas,
  campos_faltantes, aprobado_por, aprobado_en, creado_en
) VALUES (
  'demo-seed-004',
  'whatsapp', (CURRENT_DATE - INTERVAL '1 day')::text, '22:00',
  'San Justo La Matanza', 'RN 3 km 22',
  'asalto', 'alta',
  'Asalto armado a camión paquetería en RN 3. Conductor herido leve. Robaron carga.',
  '[REPORTE WHATSAPP] Asalto RN3 km 22 ayer noche. Paquetería robada. Conductor con golpes.',
  true, 1, 'publicado',
  'Buenos Aires', 'Robo Total', 'Policia de la PBA',
  'Semirremolque', 'Paquetería', 'Carga y Descarga',
  'Si', 'Auto', '1', '3',
  ARRAY[]::text[], 'varone', NOW() - INTERVAL '12 hours', NOW() - INTERVAL '1 day'
);

-- Demo Reporte 5: FALLO_PUBLICACION (badge rojo)
INSERT INTO reportes (
  hash, fuente, fecha, hora, ubicacion, ruta, tipo_incidente, gravedad,
  descripcion, texto_original, framer_enviado, framer_intentos, estado,
  provincia, tipo_incidente_framer, fuerza_interviniente,
  tipo_vehiculo, carga_transportada, modus_operandi, hubo_violencia,
  tipo_vehiculo_involucrado, cantidad_vehiculos_involucrados, cantidad_personas_involucradas,
  campos_faltantes, portal_origen, titulo_original, aprobado_por, aprobado_en, creado_en
) VALUES (
  'demo-seed-005',
  'scraping', CURRENT_DATE::text, '06:00',
  'Quilmes', 'Camino General Belgrano',
  'tentativa', 'media',
  'Tentativa de robo a camión cisterna en Camino General Belgrano. Conductor logró huir con la carga intacta.',
  '[INFOBAE] Tentativa frustrada en Quilmes, cisterna intacto.',
  false, 5, 'fallo_publicacion',
  'Buenos Aires', 'Robo en grado de Tentantiva', 'Policia de la PBA',
  'Semirremolque', 'Combustibles - Insumos Petroleros', 'Detención Eventual',
  'No', 'Moto', '2', '4',
  ARRAY[]::text[], 'infobae', 'Tentativa de asalto a camión cisterna en Quilmes',
  'varone', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '6 hours'
);

-- Seed descartes para que /descartados tenga data
INSERT INTO scrapes_descartados (portal, url, titulo, resumen, razon, matched_keywords, descartado_en) VALUES
('clarin', 'https://www.clarin.com/policiales/asalto-narco-rn34.html',
 'Hallazgo de 70 kg de cocaína en operativo de Tartagal Salta',
 'Una médica de Gendarmería y una cosmetóloga fueron detenidas tras hallarse cocaína en doble fondo',
 'blacklist', ARRAY['cocaína', 'doble fondo'], NOW() - INTERVAL '30 minutes'),
('la-nacion', 'https://www.lanacion.com.ar/policiales/homicidio-pilar.html',
 'Investigan homicidio cerca de la ruta provincial 6',
 'Un hombre fue encontrado sin vida en una zona despoblada de Pilar',
 'blacklist', ARRAY['homicidio'], NOW() - INTERVAL '1 hour'),
('cronica', 'https://cronica.com.ar/politica/ley-presupuesto.html',
 'El Congreso aprobó la nueva ley de presupuesto 2027',
 'Con 130 votos a favor, la cámara baja aprobó el proyecto del Ejecutivo',
 'sin-keywords', ARRAY[]::text[], NOW() - INTERVAL '2 hours'),
('clarin', 'https://www.clarin.com/policiales/contrabando-aduana.html',
 'La aduana incautó un camión con mercadería de contrabando',
 'Cargamento valuado en USD 200K decomisado en frontera',
 'blacklist', ARRAY['contrabando', 'aduana incautó'], NOW() - INTERVAL '3 hours'),
('pagina12', 'https://www.pagina12.com.ar/sociedad/futbol-ascenso.html',
 'Boca le ganó a River en el clásico de las inferiores',
 'El partido se jugó en cancha neutral con público dividido',
 'sin-keywords', ARRAY[]::text[], NOW() - INTERVAL '5 hours');

-- Geocoding pre-resuelto para las ubicaciones demo (así el mapa muestra markers
-- sin esperar al cron de las 4 AM).
INSERT INTO ubicaciones_geocoded (ubicacion, lat, lng, display_name, provider, not_found)
VALUES
('Acceso Sudeste km 12', -34.71, -58.30, 'Avellaneda, Buenos Aires', 'manual', false),
('Panamericana km 45 ramal Pilar', -34.45, -58.91, 'Pilar, Buenos Aires', 'manual', false),
('RN 9 km 80', -33.95, -60.38, 'San Antonio de Areco, Buenos Aires', 'manual', false),
('San Justo La Matanza', -34.67, -58.56, 'San Justo, La Matanza, Buenos Aires', 'manual', false),
('Quilmes', -34.72, -58.25, 'Quilmes, Buenos Aires', 'manual', false)
ON CONFLICT (ubicacion) DO UPDATE
  SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, display_name = EXCLUDED.display_name;

-- Verificación
SELECT id, estado, fuente, portal_origen, ubicacion, tipo_incidente, array_length(campos_faltantes, 1) as faltantes
FROM reportes ORDER BY id;
