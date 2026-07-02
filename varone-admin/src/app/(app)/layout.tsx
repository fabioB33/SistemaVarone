import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/topbar';
import { AutoRefresh } from '@/components/auto-refresh';
import { ToastContainer } from '@/components/toast-container';
import { NextActionBanner } from '@/components/next-action-banner';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  return (
    <div className="min-h-screen flex flex-col">
      <AutoRefresh />
      <Topbar user={session.user} />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
        {/* Sprint mejoras-flujo (2026-06-30): banner "next action" en todas
            las páginas. Suspense para que si el backend está caído el resto
            del panel renderee igual. */}
        <Suspense fallback={null}>
          
          <NextActionBanner />
        </Suspense>
        {children}
      </main>
      <ToastContainer />
    </div>
  );
}
