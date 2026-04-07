import { PrismaClient } from '@prisma/client';

// Singleton compartido — evita abrir múltiples pools de conexión a PostgreSQL
// cuando dedup.ts y server.ts instancian PrismaClient por separado.
const prisma = new PrismaClient();

export default prisma;
