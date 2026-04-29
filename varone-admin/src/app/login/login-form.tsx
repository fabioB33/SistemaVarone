'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Loader2 } from 'lucide-react';

interface Props {
  next?: string;
  initialError?: string;
}

export function LoginForm({ next, initialError }: Props) {
  const router = useRouter();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error || 'Credenciales inválidas');
        return;
      }
      router.replace(next || '/aprobacion?estado=pendiente');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Usuario</label>
        <input
          type="text"
          required
          autoComplete="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Contraseña</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
        />
      </div>
      {error && (
        <p className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        Entrar
      </button>
    </form>
  );
}
