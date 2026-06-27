/**
 * Auth simple por cookie firmada (HMAC-SHA256).
 *
 * Usuario único basado en ADMIN_USER/ADMIN_PASS del .env.
 * No es un sistema multi-tenant — diseñado para que Varone (1 persona)
 * acceda al dashboard. Si más adelante hay que dar acceso a más gente,
 * conviene migrar a NextAuth o similar.
 */

import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE_NAME = 'varone_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

interface SessionPayload {
  user: string;
  expiresAt: number;
}

function getSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('ADMIN_SESSION_SECRET no configurado o demasiado corto (mínimo 16 chars)');
  }
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function encodeSession(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json).toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.user || !payload?.expiresAt) return null;
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Sprint hardening 13-mejoras (2026-06-27): soporte bcrypt opcional.
 *
 * Prioridad de credenciales:
 *  1. Si `ADMIN_PASS_BCRYPT` existe → bcrypt.compare (defensa en profundidad).
 *  2. Si NO → fallback a timing-safe compare contra `ADMIN_PASS` plaintext
 *     (backwards compat — el sistema arrancó con esto).
 *
 * Para activar bcrypt:
 *   node -e "console.log(require('bcrypt').hashSync('varone2026', 12))"
 *   → pegar el resultado en ADMIN_PASS_BCRYPT del .env
 *   → comentar ADMIN_PASS (queda solo el hash)
 */
export function verifyCredentials(user: string, pass: string): boolean {
  const expectedUser = process.env.ADMIN_USER;
  if (!expectedUser) return false;

  // 1. Usuario debe matchear (timing-safe)
  const userA = Buffer.from(user);
  const userB = Buffer.from(expectedUser);
  if (userA.length !== userB.length) return false;
  if (!crypto.timingSafeEqual(userA, userB)) return false;

  // 2. Bcrypt path (preferido)
  const bcryptHash = process.env.ADMIN_PASS_BCRYPT;
  if (bcryptHash) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bcrypt = require('bcrypt') as { compareSync: (a: string, b: string) => boolean };
      return bcrypt.compareSync(pass, bcryptHash);
    } catch {
      // bcrypt no instalado → fallback al plaintext (con warn)
      console.warn('[Auth] ADMIN_PASS_BCRYPT seteado pero @types/bcrypt no instalado. Fallback a plaintext.');
    }
  }

  // 3. Fallback: timing-safe compare contra plaintext (backwards compat)
  const expectedPass = process.env.ADMIN_PASS;
  if (!expectedPass) return false;
  const passA = Buffer.from(pass);
  const passB = Buffer.from(expectedPass);
  if (passA.length !== passB.length) return false;
  return crypto.timingSafeEqual(passA, passB);
}

export async function createSession(user: string): Promise<void> {
  const token = encodeSession({ user, expiresAt: Date.now() + SESSION_TTL_MS });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Devuelve la sesión actual o null si no hay / es inválida / expiró. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return decodeSession(token);
}
