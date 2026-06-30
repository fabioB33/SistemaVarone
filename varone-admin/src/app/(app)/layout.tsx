import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/topbar';
import { AutoRefresh } from '@/components/auto-refresh';
import { ToastContainer } from '@/components/toast-container';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  return (
    <div className="min-h-screen flex flex-col">
      <AutoRefresh />
      <Topbar user={session.user} />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
      <ToastContainer />
    </div>
  );
}
