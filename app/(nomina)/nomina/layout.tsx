import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { EN_PRUEBAS } from "@/lib/ambiente";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { empleados, tiendas } from "@/lib/rrhh/db";
import { NavNomina } from "./NavNomina";
import { ActuarComo } from "./ActuarComo";
import "./nomina.css";

// Siempre con sesión: nunca prerenderizar (el permiso se evalúa por petición).
export const dynamic = "force-dynamic";

// LA APP DE NÓMINA — pantalla completa, fuera de la cáscara de contabilidad.
// Misma estructura que Oak-Crew (la app de referencia): barra lateral blanca
// con los grupos General · Operación · Finanzas y reportes · Cuenta, cabecera
// con "Vista cliente" y "Cerrar sesión", contenido en tarjetas. Decisión de
// Daniel (2026-10-06): al probar se perdía entre dos menús; que se vea igual
// a lo que ya conoce.
export default async function NominaLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  const p = await perspectiva();
  if (!puede(u.rol, "nomina") && p.tipo === "rrhh" && !p.empleado) redirect("/");
  const [emps, ts] = EN_PRUEBAS ? await Promise.all([empleados(), tiendas()]) : [[], []];
  const quien = p.tipo === "rrhh" ? (p.empleado?.nombre_completo ?? u.email) : p.empleado.nombre_completo;
  const rol = { rrhh: "Gestor RRHH", admin_punto: "Administrador de punto", colaborador: "Colaborador" }[p.tipo];
  const iniciales = quien.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const salir = async () => { "use server"; await signOut({ redirectTo: "/login" }); };
  return (
    <div className="oc">
      <aside className="oc-side">
        <div className="oc-brand"><span className="oc-logo">🫐</span><b>OAKBERRY</b><small>Nómina</small></div>
        <NavNomina tipo={p.tipo} />
        <div className="oc-user">
          <span className="oc-avatar">{iniciales}</span>
          <div><b>{quien}</b><i>{rol}</i></div>
          <form action={salir}><button type="submit" title="Cerrar sesión">⎋</button></form>
        </div>
      </aside>
      <div className="oc-body">
        <header className="oc-top">
          <div className="oc-top-l">Vista cliente: <b>OAKBERRY</b>{EN_PRUEBAS && <span className="oc-pruebas">ambiente de pruebas · datos inventados</span>}</div>
          <div className="oc-top-r">
            {EN_PRUEBAS && <ActuarComo p={p} empleados={emps.map((e) => ({ id: e.activo_id, nombre: e.nombre_completo, rol: e.rol_app, tienda: ts.find((t) => t.id === e.punto)?.nombre ?? e.punto }))} />}
            <a href="/" className="oc-link">Portal</a>
            <form action={salir}><button type="submit" className="oc-salir">⎋ Cerrar sesión</button></form>
          </div>
        </header>
        <main className="oc-main">{children}</main>
      </div>
    </div>
  );
}
