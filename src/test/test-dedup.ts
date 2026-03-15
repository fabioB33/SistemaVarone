import dotenv from 'dotenv';
dotenv.config();

import { existeDuplicado, registrarReporte } from '../services/dedup';
import { PrismaClient } from '@prisma/client';

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const prisma = new PrismaClient();

async function testDedup(): Promise<void> {
  console.log('\n' + '='.repeat(50));
  console.log(`${BOLD}  Test Anti-Duplicados (PostgreSQL)${RESET}`);
  console.log('='.repeat(50) + '\n');

  const textoTest = 'Robo de camión en Ruta 9 km 72 - TEST ' + Date.now();
  let fallos = 0;

  // Test 1: Texto nuevo no debe ser duplicado
  const esDup1 = await existeDuplicado(textoTest);
  if (!esDup1) {
    console.log(`  ${VERDE}✓${RESET} Texto nuevo correctamente identificado como NO duplicado`);
  } else {
    console.log(`  ${ROJO}✗${RESET} Texto nuevo fue marcado como duplicado (ERROR)`);
    fallos++;
  }

  // Test 2: Registrar el reporte
  await registrarReporte(textoTest, {
    fuente: 'whatsapp',
    fecha: '2026-03-10',
    ubicacion: 'Ruta 9 km 72',
    ruta: 'Ruta 9',
    tipoIncidente: 'robo de carga',
    descripcion: 'Test de duplicados',
  });
  console.log(`  ${VERDE}✓${RESET} Reporte registrado en DB`);

  // Test 3: Ahora sí debe ser duplicado
  const esDup2 = await existeDuplicado(textoTest);
  if (esDup2) {
    console.log(`  ${VERDE}✓${RESET} Texto repetido correctamente identificado como DUPLICADO`);
  } else {
    console.log(`  ${ROJO}✗${RESET} Texto repetido no fue detectado como duplicado (ERROR)`);
    fallos++;
  }

  // Test 4: Variación mínima (espacios extra) debe ser el mismo hash
  const textoConEspacios = textoTest.replace('Ruta', 'Ruta  ');
  const esDup3 = await existeDuplicado(textoConEspacios);
  if (esDup3) {
    console.log(`  ${VERDE}✓${RESET} Texto con espacios extra detectado como duplicado (normalización OK)`);
  } else {
    console.log(`  ${ROJO}✗${RESET} Normalización de espacios falló`);
    fallos++;
  }

  // Test 5: Texto completamente diferente no debe ser duplicado
  const textoDiferente = 'Bloqueo en Ruta 34 por piquete - completamente distinto ' + Date.now();
  const esDup4 = await existeDuplicado(textoDiferente);
  if (!esDup4) {
    console.log(`  ${VERDE}✓${RESET} Texto diferente correctamente NO es duplicado`);
  } else {
    console.log(`  ${ROJO}✗${RESET} Texto diferente fue marcado como duplicado (ERROR)`);
    fallos++;
  }

  // Limpiar datos de test
  await prisma.reporte.deleteMany({
    where: { descripcion: 'Test de duplicados' },
  });
  console.log(`\n  Datos de test limpiados.`);

  // Resumen
  console.log('\n' + '='.repeat(50));
  if (fallos === 0) {
    console.log(`  ${VERDE}${BOLD}Todos los tests pasaron ✓${RESET}`);
  } else {
    console.log(`  ${ROJO}${BOLD}${fallos} test(s) fallaron ✗${RESET}`);
  }
  console.log('='.repeat(50) + '\n');

  await prisma.$disconnect();
  process.exit(fallos > 0 ? 1 : 0);
}

testDedup().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
