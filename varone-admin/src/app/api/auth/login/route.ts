import { NextResponse } from 'next/server';
import { createSession, verifyCredentials } from '@/lib/auth';

export async function POST(req: Request) {
  let body: { user?: string; pass?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 });
  }
  const { user, pass } = body;
  if (!user || !pass) {
    return NextResponse.json({ ok: false, error: 'Falta usuario o contraseña' }, { status: 400 });
  }
  if (!verifyCredentials(user, pass)) {
    return NextResponse.json({ ok: false, error: 'Credenciales inválidas' }, { status: 401 });
  }
  await createSession(user);
  return NextResponse.json({ ok: true });
}
