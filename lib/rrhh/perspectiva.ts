// QUIÉN ESTÁ ACTUANDO en el módulo RRHH.
//
// Tres perspectivas: RRHH (ve y aprueba todo), administrador de punto (su
// tienda: planifica, revisa marcaciones, aprueba permisos) y colaborador (lo
// suyo: horario, marcar, pedir permiso). En producción sale del correo con el
// que entró (rrhh_empleados.email) o del rol del portal (admin/operador = RRHH).
// En PRUEBAS se puede "actuar como" cualquier persona del maestro inventado,
// con una cookie, para validar las tres vistas con un solo login.
import { cookies } from "next/headers";
import { getCurrentUser, type Usuario } from "@/lib/auth";
import { EN_PRUEBAS } from "@/lib/ambiente";
import { puede } from "@/lib/permisos";
import { empleado, empleadoPorEmail, type EmpleadoDb } from "./db";

export const COOKIE_COMO = "rrhh_como";
export type Perspectiva =
  | { tipo: "rrhh"; usuario: Usuario; empleado: EmpleadoDb | null }
  | { tipo: "admin_punto"; usuario: Usuario; empleado: EmpleadoDb; tiendaId: string }
  | { tipo: "colaborador"; usuario: Usuario; empleado: EmpleadoDb; tiendaId: string };

export async function perspectiva(): Promise<Perspectiva> {
  const usuario = await getCurrentUser();
  if (EN_PRUEBAS) {
    const v = (await cookies()).get(COOKIE_COMO)?.value;
    if (v && v !== "rrhh") {
      const e = await empleado(Number(v));
      if (e) return e.rol_app === "admin_punto" ? { tipo: "admin_punto", usuario, empleado: e, tiendaId: e.punto } : { tipo: "colaborador", usuario, empleado: e, tiendaId: e.punto };
    }
  }
  const e = await empleadoPorEmail(usuario.email);
  if (e && e.rol_app === "admin_punto" && !puede(usuario.rol, "nomina")) return { tipo: "admin_punto", usuario, empleado: e, tiendaId: e.punto };
  if (e && e.rol_app === "colaborador" && !puede(usuario.rol, "nomina")) return { tipo: "colaborador", usuario, empleado: e, tiendaId: e.punto };
  return { tipo: "rrhh", usuario, empleado: e };
}

/** Nombre con el que firma en la bitácora. */
export const actorDe = (p: Perspectiva) => (p.tipo === "rrhh" ? p.usuario.email : `${p.usuario.email} como ${p.empleado.nombre_completo}`);

export function puedePlanificar(p: Perspectiva, tiendaId: string) { return p.tipo === "rrhh" || (p.tipo === "admin_punto" && p.tiendaId === tiendaId); }
export function puedeRevisar(p: Perspectiva, tiendaId: string) { return puedePlanificar(p, tiendaId); }
export function puedeVerEmpleado(p: Perspectiva, e: { activo_id: number; punto: string }) {
  return p.tipo === "rrhh" || (p.tipo === "admin_punto" && p.tiendaId === e.punto) || (p.tipo === "colaborador" && p.empleado.activo_id === e.activo_id);
}
