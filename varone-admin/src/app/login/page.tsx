import { Truck, Shield, Zap, Inbox } from 'lucide-react';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="relative grid min-h-screen lg:grid-cols-[1.1fr,1fr]">
      {/* Hero columna izquierda */}
      <section className="relative hidden flex-col justify-between border-r border-line bg-gradient-to-br from-canvas via-surface/50 to-canvas px-12 py-12 lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-strong shadow-lg ring-1 ring-accent/30">
            <Truck className="size-5 text-accent-fg" strokeWidth={2.5} />
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-base font-semibold tracking-tight text-fg">Varone</span>
            <span className="mt-1 text-2xs uppercase tracking-[0.18em] text-fg-muted">
              Centro de monitoreo
            </span>
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-3 py-1 text-2xs font-medium uppercase tracking-wider text-accent">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />
              Sistema operativo
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-fg">
              Decisiones rápidas
              <br />
              sobre datos en tiempo real.
            </h1>
            <p className="mt-4 max-w-prose text-base leading-relaxed text-fg-muted">
              Captura automática desde WhatsApp, clasificación con IA y publicación
              moderada en el sitio público. Todo desde un panel.
            </p>
          </div>

          <ul className="space-y-3">
            <Bullet icon={Inbox} title="Cola de aprobación" desc="Cada noticia pasa por tu revisión antes del sitio." />
            <Bullet icon={Shield} title="Trazabilidad completa" desc="Quién, cuándo y qué cambió. Audit log inmutable." />
            <Bullet icon={Zap} title="Acciones desde el celular" desc="Aprobar o descartar con un tap, sin abrir laptop." />
          </ul>
        </div>

        <p className="text-2xs uppercase tracking-[0.18em] text-fg-subtle">
          Pampa Labs · Sistema Varone v1
        </p>
      </section>

      {/* Form columna derecha */}
      <section className="grid place-items-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-sm">
          {/* Brand mobile */}
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 place-items-center rounded-md bg-gradient-to-br from-accent to-accent-strong shadow-sm ring-1 ring-accent/30">
              <Truck className="size-4 text-accent-fg" strokeWidth={2.5} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-fg">Varone</span>
          </div>

          <header className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight text-fg">
              Iniciar sesión
            </h2>
            <p className="mt-1.5 text-sm text-fg-muted">
              Ingresá con tus credenciales para acceder al panel.
            </p>
          </header>

          <LoginForm next={sp.next} initialError={sp.error} />

          <p className="mt-8 text-center text-xs text-fg-subtle">
            ¿Problemas para ingresar? Contactá a Pampa Labs.
          </p>
        </div>
      </section>
    </main>
  );
}

function Bullet({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-line bg-surface">
        <Icon className="size-4 text-accent" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-sm text-fg-muted">{desc}</p>
      </div>
    </li>
  );
}
