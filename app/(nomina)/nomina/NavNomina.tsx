"use client";
import { usePathname } from "next/navigation";
import { ruta } from "@/lib/ruta";

// LA BARRA LATERAL: mismos grupos, mismos nombres y mismo orden que Oak-Crew,
// más lo nuestro (Marcar, Mi horario, Marcaciones, Bitácora, Reglas) en el
// sitio donde uno lo buscaría. Lo que no aplica al rol no se muestra.
type Rol = "rrhh" | "admin_punto" | "colaborador";
type Item = { href: string; label: string; ico: string; solo?: Rol[] };
const GRUPOS: { titulo: string; items: Item[] }[] = [
  { titulo: "General", items: [
    { href: "/nomina", label: "Dashboard", ico: "▦", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/mi-horario", label: "Mi horario", ico: "🗓" },
    { href: "/nomina/marcar", label: "Marcar asistencia", ico: "🤳" },
  ] },
  { titulo: "Operación", items: [
    { href: "/nomina/empleados", label: "Empleados", ico: "👥", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/tiendas", label: "Centros / Tiendas", ico: "📍", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/integracion", label: "Integración ventas", ico: "🔗", solo: ["rrhh"] },
    { href: "/nomina/planificacion", label: "Planificación", ico: "📅", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/marcacion", label: "Marcaciones", ico: "📋", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/turnos-extra", label: "Turnos extra", ico: "➕", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/intercambio", label: "Intercambio turnos", ico: "⇄", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/ausencias", label: "Gestión ausencias", ico: "🌴", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/solicitudes", label: "Solicitudes", ico: "📨" },
  ] },
  { titulo: "Finanzas y reportes", items: [
    { href: "/nomina/reportes", label: "Reportes", ico: "📄", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/costos", label: "Costos laborales", ico: "💰", solo: ["rrhh"] },
    { href: "/nomina/financiero", label: "Dashboard financiero", ico: "📈", solo: ["rrhh"] },
    { href: "/nomina/incentivos", label: "Incentivos", ico: "🏆", solo: ["rrhh", "admin_punto"] },
    { href: "/nomina/quincena", label: "Nómina", ico: "🧾", solo: ["rrhh"] },
    { href: "/nomina/liquidaciones", label: "Liquidaciones", ico: "📤", solo: ["rrhh"] },
    { href: "/nomina/cumplimiento", label: "Cumplimiento", ico: "⚖️", solo: ["rrhh", "admin_punto"] },
  ] },
  { titulo: "Configuración", items: [
    { href: "/nomina/reglas", label: "Reglas y vigencias", ico: "⚙️", solo: ["rrhh"] },
    { href: "/nomina/bitacora", label: "Bitácora", ico: "📜", solo: ["rrhh"] },
  ] },
  { titulo: "Cuenta", items: [{ href: "/nomina/perfil", label: "Mi perfil", ico: "🙂" }] },
];

export function NavNomina({ tipo }: { tipo: Rol }) {
  const p = usePathname();
  const on = (h: string) => (h === "/nomina" ? p === "/nomina" : p.startsWith(h));
  return (
    <nav className="oc-nav">
      {GRUPOS.map((g) => {
        const items = g.items.filter((i) => !i.solo || i.solo.includes(tipo));
        if (!items.length) return null;
        return (
          <div key={g.titulo} className="oc-grupo">
            <h4>{g.titulo}</h4>
            {items.map((i) => <a key={i.href} href={ruta(i.href)} className={on(i.href) ? "on" : ""}><i>{i.ico}</i>{i.label}</a>)}
          </div>
        );
      })}
    </nav>
  );
}
