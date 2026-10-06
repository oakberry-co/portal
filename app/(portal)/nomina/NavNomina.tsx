"use client";
import { usePathname } from "next/navigation";
import { ruta } from "@/lib/ruta";

const GRUPOS: { titulo: string; items: { href: string; label: string; ico: string }[] }[] = [
  { titulo: "General", items: [{ href: "/nomina", label: "Dashboard", ico: "▦" }] },
  { titulo: "Operación", items: [
    { href: "/nomina/empleados", label: "Empleados", ico: "👤" },
    { href: "/nomina/tiendas", label: "Centros / Tiendas", ico: "📍" },
    { href: "/nomina/planificacion", label: "Planificación", ico: "🗓" },
    { href: "/nomina/marcacion", label: "Marcación", ico: "🤳" },
    { href: "/nomina/turnos-extra", label: "Turnos extra", ico: "➕" },
    { href: "/nomina/intercambio", label: "Intercambio de turnos", ico: "⇄" },
    { href: "/nomina/ausencias", label: "Gestión de ausencias", ico: "🌴" },
    { href: "/nomina/solicitudes", label: "Solicitudes", ico: "📨" },
  ] },
  { titulo: "Finanzas y reportes", items: [
    { href: "/nomina/reportes", label: "Reportes", ico: "📄" },
    { href: "/nomina/costos", label: "Costos laborales", ico: "💰" },
    { href: "/nomina/financiero", label: "Dashboard financiero", ico: "📈" },
    { href: "/nomina/quincena", label: "Nómina", ico: "🧾" },
    { href: "/nomina/liquidaciones", label: "Liquidaciones", ico: "📤" },
    { href: "/nomina/incentivos", label: "Incentivos", ico: "🏆" },
    { href: "/nomina/cumplimiento", label: "Cumplimiento", ico: "⚖️" },
  ] },
  { titulo: "Configuración", items: [
    { href: "/nomina/reglas", label: "Reglas y vigencias", ico: "⚙️" },
    { href: "/nomina/integracion", label: "Ventas (DW)", ico: "🔗" },
    { href: "/nomina/perfil", label: "Mi perfil", ico: "🙂" },
  ] },
];

export function NavNomina() {
  const p = usePathname();
  const on = (h: string) => (h === "/nomina" ? p === "/nomina" : p.startsWith(h));
  return (
    <aside className="nm-side">
      <div className="nm-borrador"><b>Borrador visual.</b> Empleados = maestro real. Turnos, marcaciones y solicitudes son de muestra. Nada se guarda.</div>
      {GRUPOS.map((g) => (
        <div key={g.titulo}>
          <h4>{g.titulo}</h4>
          {g.items.map((i) => (
            <a key={i.href} href={ruta(i.href)} className={on(i.href) ? "on" : ""}><i>{i.ico}</i>{i.label}</a>
          ))}
        </div>
      ))}
    </aside>
  );
}
