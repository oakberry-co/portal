import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { EN_PRUEBAS } from "@/lib/ambiente";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { empleados, tiendas } from "@/lib/rrhh/db";
import { CascaraPortal } from "@/app/(portal)/CascaraPortal";
import { areasPara } from "@/app/(portal)/areas";
import "@/app/(portal)/portal.css";
import { ActuarComo } from "./ActuarComo";
import "./nomina.css";

// Siempre con sesión: nunca prerenderizar (el permiso se evalúa por petición).
export const dynamic = "force-dynamic";

// LA APP DE NÓMINA — dentro de la cáscara del portal (23-oct-2026): su menú (los
// grupos General · Operación · Finanzas y reportes · Configuración · Cuenta, los
// mismos de Oak-Crew) es ahora el área "Recursos humanos" de la barra lateral de
// todo manelfoods.co (app/(portal)/areas.ts), filtrado por la perspectiva de quien
// entra. Antes tenía su propia barra (2026-10-06: "se perdía entre dos menús"); con
// una sola barra para todo el portal, ese problema desaparece. El contenido sigue
// dentro de .oc para que los estilos de nomina.css apliquen igual.
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
    <CascaraPortal areas={areasPara(u.rol, p.tipo)} email={u.email} rol={rol} iniciales={iniciales} salir={salir}
      derecha={<>
        {EN_PRUEBAS && <span className="oc-pruebas">ambiente de pruebas · datos inventados</span>}
        {EN_PRUEBAS && <ActuarComo p={p} empleados={emps.map((e) => ({ id: e.activo_id, nombre: e.nombre_completo, rol: e.rol_app, tienda: ts.find((t) => t.id === e.punto)?.nombre ?? e.punto }))} />}
        <span className="nav-who"><b>{quien}</b><i>{rol}</i></span>
      </>}>
      <div className="oc oc-dentro"><main className="oc-main">{children}</main></div>
    </CascaraPortal>
  );
}
