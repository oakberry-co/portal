import { getCurrentUserOrNull, type Rol } from "@/lib/auth";
import { puede, type Cap } from "@/lib/permisos";
import { MenuPortal, type GrupoMenu } from "./MenuPortal";
import { signOut } from "@/auth";
import { AsistenteFloating } from "./AsistenteFloating";

// El portal interno: menú + sesión. Las landings públicas (/cuentas-de-cobro y
// /cotizaciones) quedan FUERA de este grupo y por eso no lo heredan.
// `(portal)` es un route group: no cambia ninguna URL.
// El menú, en 4 grupos (pedido de Daniel 2026-08-18). Cada ítem lleva la
// capacidad que lo habilita: un grupo aparece solo si la persona puede ver al
// menos uno de sus ítems, así el contador externo no ve cajones vacíos.
//
// Los ítems SIN href son los que todavía no existen: se muestran como "pronto"
// a propósito, para que el equipo sepa qué viene y no los pida dos veces.
type Item = { label: string; href?: string; cap: Cap };
type Grupo = { label: string; href?: string; cap?: Cap; items?: Item[]; pronto?: boolean };

const MENU: Grupo[] = [
  { label: "Dashboard", href: "/contabilidad/dashboard", cap: "dashboard" },
  {
    label: "Contabilidad",
    items: [
      { label: "Conciliación de pagos", href: "/contabilidad/conciliacion", cap: "ver_conciliacion" },
      { label: "Pagos", href: "/contabilidad/pagos", cap: "ver_pagos" },
      { label: "Conciliación de bancos", cap: "pagos" },
      { label: "Cuentas de cobro", href: "/contabilidad/cuentas-de-cobro", cap: "intake" },
      { label: "Cotizaciones", href: "/contabilidad/cotizaciones", cap: "intake" },
      { label: "Órdenes de compra", cap: "ver_conciliacion" },
      { label: "Pagos internacionales", cap: "pagos" },
      { label: "Causaciones", cap: "clasificar" },
    ],
  },
  // El nivel de arriba son las ÁREAS del negocio, no los módulos: el portal es
  // la cáscara de TODA la operación, no solo de contabilidad. Las que aún no
  // tienen módulos van marcadas "pronto" — verlas desde ya evita que cada área
  // salga a montar su propia herramienta por fuera.
  { label: "Recursos humanos", pronto: true },
  { label: "Operaciones", pronto: true },
  { label: "Mercadeo", pronto: true },
  { label: "Finanzas", pronto: true },
  {
    label: "Configuraciones",
    items: [
      { label: "Maestros", href: "/contabilidad/maestros", cap: "maestros" },
      { label: "Soportes", href: "/contabilidad/soportes", cap: "ver_conciliacion" },
      { label: "Configuración", href: "/contabilidad/configuracion", cap: "usuarios" },
    ],
  },
];

/** Deja solo lo que el rol puede ver, y descarta los grupos que quedan vacíos. */
function menuPara(rol: Rol): GrupoMenu[] {
  const salida: GrupoMenu[] = [];
  for (const g of MENU) {
    if (g.pronto) { salida.push({ label: g.label, pronto: true }); continue; }
    if (g.href) {
      if (!g.cap || puede(rol, g.cap)) salida.push({ label: g.label, href: g.href });
      continue;
    }
    const items = (g.items ?? [])
      .filter((i) => puede(rol, i.cap))
      .map(({ label, href }) => ({ label, href }));
    if (items.length) salida.push({ label: g.label, items });
  }
  return salida;
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserOrNull();
  return (
    <>
      {user && (
        <header className="nav">
          <a href="/" className="nav-brand">
            <span className="nav-dot" />Oakberry<span className="nav-thin">· Portal</span>
          </a>
          <MenuPortal grupos={menuPara(user.rol)} />
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
