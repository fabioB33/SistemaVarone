import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware liviano: si hay cookie de sesión, sigue; si no, redirige a /login.
 * La verificación de firma se hace en cada Server Component vía getSession().
 */
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  // /quick/[token] es accesible sin login: el token HMAC ya valida la accion.
  '/quick',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('varone_session')?.value;
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
