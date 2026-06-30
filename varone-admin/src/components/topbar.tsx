'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Truck, Map as MapIcon, Inbox, Trash2, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AlertasBadge } from './alertas-badge';
import { ErroresPublicacionBadge } from './errores-publicacion-badge';
import { PublisherHealthBadge } from './publisher-health-badge';

// Sprint flow-unificado-aprobacion (2026-06-28): PendientesRevisionBadge
// eliminado. Los campos faltantes ahora viven inline en la card de
// /aprobacion. Un solo badge de acción humana = "Aprobación".

const NAV_LINKS = [
  // Sprint demo-readiness (2026-06-30): home/centro de comando.
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard, matchPaths: ['/dashboard'] },
  { href: '/aprobacion?estado=pendiente', label: 'Aprobación', icon: Inbox, matchPaths: ['/aprobacion'] },
  { href: '/mapa', label: 'Mapa', icon: MapIcon, matchPaths: ['/mapa'] },
  // Sprint scrapers-portales (2026-06-30): auditoría del pre-filtro.
  { href: '/descartados', label: 'Descartes', icon: Trash2, matchPaths: ['/descartados'] },
];

interface Props {
  user: string;
}

export function Topbar({ user }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/65">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-6">
        {/* Brand mark */}
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          aria-label="Inicio Varone"
        >
          <span className="relative grid size-9 place-items-center rounded-md bg-gradient-to-br from-accent to-accent-strong shadow-sm ring-1 ring-accent/30">
            <Truck className="size-4 text-accent-fg" strokeWidth={2.5} />
            <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-ok ring-2 ring-canvas" />
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight text-fg">
              Varone
            </span>
            <span className="mt-0.5 text-2xs uppercase tracking-[0.18em] text-fg-muted">
              Centro de monitoreo
            </span>
          </div>
        </Link>

        {/* Center nav — Sprint mapa (2026-06-27) */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map(({ href, label, icon: Icon, matchPaths }) => {
            const isActive = matchPaths.some((p) => pathname?.startsWith(p));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:bg-subtle/60 hover:text-fg',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-3">
          <PublisherHealthBadge />
          <ErroresPublicacionBadge />
          <AlertasBadge />
          <div className="hidden items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1.5 text-xs sm:flex">
            <span className="text-fg-muted">Sesión</span>
            <span className="size-1 rounded-full bg-fg-subtle" />
            <span className="font-medium text-fg">{user}</span>
          </div>
          <button
            onClick={logout}
            className="vc-btn vc-btn-ghost vc-btn-sm"
            aria-label="Cerrar sesión"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
}
