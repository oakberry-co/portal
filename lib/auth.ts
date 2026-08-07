// Autoría de cada acción — quién hace qué y con qué permiso.
//
//  - Local (AUTH_MODE=dev): usuario fijo, SIN login, para correr sin Google.
//  - Prod/pruebas (AUTH_MODE=google): sesión real de Auth.js (Google, ver auth.ts);
//    el rol se lee de la tabla `usuarios` (correo -> rol).
//  - Opción B (futuro): Firebase Auth. El contrato NO cambia: la app siempre
//    llama getCurrentUser() y recibe { email, rol }. Ver README "Auth: Opción B".
import { auth } from "@/auth";
import { getPool } from "@/lib/db";

export type Rol = "conciliador" | "pagador" | "causador" | "admin";
export type Usuario = { email: string; rol: Rol };

// Rol para un correo autorizado que aún no está en la tabla `usuarios`.
// Mínimo privilegio: 'conciliador' (puede clasificar; NO puede lo de admin).
const DEFAULT_ROL: Rol = (process.env.AUTH_DEFAULT_ROL as Rol) ?? "conciliador";

/** Usuario autenticado. Lanza si no hay sesión — usar en acciones protegidas. */
export async function getCurrentUser(): Promise<Usuario> {
  const u = await getCurrentUserOrNull();
  if (!u) throw new Error("No autenticado.");
  return u;
}

/** Como getCurrentUser pero devuelve null sin sesión (para el layout / login). */
export async function getCurrentUserOrNull(): Promise<Usuario | null> {
  const mode = process.env.AUTH_MODE ?? "dev";

  if (mode === "dev") {
    return {
      email: process.env.DEV_USER_EMAIL ?? "dev@localhost",
      rol: (process.env.DEV_USER_ROL as Rol) ?? "admin",
    };
  }

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  return { email, rol: await rolDe(email) };
}

/** Rol del correo según la tabla `usuarios`. Si no está (o la base no responde),
 *  cae al rol por defecto — nunca otorga más permiso del mínimo. */
async function rolDe(email: string): Promise<Rol> {
  try {
    const r = await getPool().query<{ rol: Rol }>(
      "SELECT rol FROM usuarios WHERE email = $1 AND activo",
      [email]
    );
    if (r.rowCount && r.rows[0]?.rol) return r.rows[0].rol;
  } catch {
    // base ausente o error transitorio -> rol por defecto (no bloquea el login)
  }
  return DEFAULT_ROL;
}

/** ¿El rol tiene al menos el permiso pedido? admin puede todo. */
export function tienePermiso(rol: Rol, requerido: Rol): boolean {
  return rol === "admin" || rol === requerido;
}
