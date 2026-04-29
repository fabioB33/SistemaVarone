import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Varone Admin',
  description: 'Panel de aprobación de noticias del Sistema Varone',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="font-sans">{children}</body>
    </html>
  );
}
