'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';

export function Topbar({ user }: { user: string }) {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <ShieldCheck className="size-4 text-emerald-400" />
          Varone Admin
        </Link>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="hidden sm:inline">Sesión: <span className="text-slate-200">{user}</span></span>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 px-2.5 py-1.5 text-slate-300 transition hover:border-slate-700 hover:text-slate-100"
          >
            <LogOut className="size-3.5" />
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
