import { getCurrentUserOrNull } from "@/lib/auth";
import { puede, type Cap } from "@/lib/permisos";
import { signOut } from "@/auth";
import { AsistenteFloating } from "./AsistenteFloating";

// El portal interno: menú + sesión. Las landings públicas (/cuentas-de-cobro y
// /cotizaciones) quedan FUERA de este grupo y por eso no lo heredan.
// `(portal)` es un route group: no cambia ninguna URL.
const MENU: { label: string; href?: string; cap: Cap }[] = [
  { label: "Conciliación", href: "/contabilidad/conciliacion", cap: "ver_conciliacion" },
  { label: "Pagos", href: "/contabilidad/pagos", cap: "ver_pagos" },
  { label: "Causación", cap: "clasificar" },
  { label: "Bancos", cap: "pagos" },
  { label: "Maestros", href: "/contabilidad/maestros", cap: "maestros" },
  { label: "Soportes", href: "/contabilidad/soportes", cap: "ver_conciliacion" },
  { label: "Dashboard", href: "/contabilidad/dashboard", cap: "dashboard" },
  { label: "Cuentas de cobro", href: "/contabilidad/cuentas-de-cobro", cap: "intake" },
  { label: "Cotizaciones", href: "/contabilidad/cotizaciones", cap: "intake" },
  { label: "Configuración", href: "/contabilidad/configuracion", cap: "usuarios" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserOrNull();
  return (
    <>
      {user && (
        <header className="nav">
          <a href="/" className="nav-brand">
            <span className="nav-dot" />Oakberry<span className="nav-thin">· Portal</span>
          </a>
          <nav className="nav-menu">
            {MENU.filter((m) => puede(user.rol, m.cap)).map((m) =>
              m.href ? (
                <a key={m.label} href={m.href} className="nav-link">{m.label}</a>
              ) : (
                <span key={m.label} className="nav-link soon">{m.label}<i>pronto</i></span>
              )
            )}
          </nav>
          <div className="nav-user">
            <span className="nav-who"><b>{user.email}</b><i>{user.rol}</i></span>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
              <button className="nav-out" type="submit">Salir</button>
            </form>
          </div>
        </header>
      )}
      {children}
      {user && puede(user.rol, "asistente") && <AsistenteFloating />}
    </>
  );
}
