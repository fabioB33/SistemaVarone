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

/** Verifica credenciales contra ADMIN_USER/PASS del entorno. */
export function verifyCredentials(user: string, pass: string): boolean {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPass = process.env.ADMIN_PASS;
  if (!expectedUser || !expectedPass) return false;
  // Comparación timing-safe
  const a = Buffer.from(`${user}:${pass}`);
  const b = Buffer.from(`${expectedUser}:${expectedPass}`);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
