import { redirect } from 'next/navigation';

export default function HomePage() {
  // Sprint demo-readiness (2026-06-30): home redirige al centro de comando.
  redirect('/dashboard');
}
