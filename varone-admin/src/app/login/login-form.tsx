'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';

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
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="user" className="vc-label">Usuario</label>
        <input
          id="user"
          type="text"
          required
          autoComplete="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="varone"
          className="vc-input"
        />
      </div>

      <div>
        <label htmlFor="pass" className="vc-label">Contraseña</label>
        <input
          id="pass"
          type="password"
          required
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="••••••••"
          className="vc-input"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger animate-fade-in"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="vc-btn vc-btn-primary vc-btn-md w-full"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Verificando…
          </>
        ) : (
          <>
            <LogIn className="size-4" />
            Iniciar sesión
          </>
        )}
      </button>
    </form>
  );
}
