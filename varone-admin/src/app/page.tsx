import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/aprobacion?estado=pendiente');
}
