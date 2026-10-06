import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { EN_PRUEBAS } from "@/lib/ambiente";
import { redirect } from "next/navigation";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { empleados, tiendas } from "@/lib/rrhh/db";
import { NavNomina } from "./NavNomina";
import { ActuarComo } from "./ActuarComo";
import "./nomina.css";

// Siempre con sesión: nunca prerenderizar (el permiso se evalúa por petición).
export const dynamic = "force-dynamic";

// VENTANA NÓMINA — módulo RRHH (spec gs://oakberry-col-core/04_rrhh/00_README.md v3).
// Entra quien tenga la capacidad `nomina` (decisor) o esté en el maestro de
// empleados con su correo (colaborador / administrador de punto). La vista que
// ve cada uno la decide `perspectiva()`.
export default async function NominaLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  const p = await perspectiva();
  if (!puede(u.rol, "nomina") && p.tipo === "rrhh" && !p.empleado) redirect("/");
  const [emps, ts] = EN_PRUEBAS ? await Promise.all([empleados(), tiendas()]) : [[], []];
  return (
    <div className="nm-wrap">
      <div>
        {EN_PRUEBAS && <ActuarComo p={p} empleados={emps.map((e) => ({ id: e.activo_id, nombre: e.nombre_completo, rol: e.rol_app, tienda: ts.find((t) => t.id === e.punto)?.nombre ?? e.punto }))} />}
        <NavNomina tipo={p.tipo} />
      </div>
      <main className="nm-main">{children}</main>
    </div>
  );
}
