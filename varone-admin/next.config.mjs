import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Limita el file tracing al varone-admin para no escanear el monorepo entero.
  outputFileTracingRoot: __dirname,

  // Reescribe peticiones del cliente al backend del Sistema Varone (Express).
  // Evita CORS y permite usar paths relativos (`/api/aprobacion/lista`).
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_SISTEMA_VARONE_URL || 'http://127.0.0.1:3000';
    return [
      {
        source: '/backend/:path*',
        destination: `${backend}/:path*`,
      },
    ];
  },
};

export default nextConfig;
