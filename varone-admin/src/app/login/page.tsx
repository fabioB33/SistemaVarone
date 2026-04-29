import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Varone Admin</h1>
          <p className="mt-2 text-sm text-slate-400">Panel de aprobación de noticias</p>
        </header>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur">
          <LoginForm next={sp.next} initialError={sp.error} />
        </div>
      </div>
    </main>
  );
}
