// Autoría de cada acción — quién hace qué y con qué permiso.
//
//  - Local (AUTH_MODE=dev): usuario fijo, SIN login, para correr sin Google.
//  - Prod/pruebas (AUTH_MODE=google): sesión real de Auth.js (Google, ver auth.ts);
//    el rol se lee de la tabla `usuarios` (correo -> rol).
//  - Opción B (futuro): Firebase Auth. El contrato NO cambia: la app siempre
//    llama getCurrentUser() y recibe { email, rol }. Ver README "Auth: Opción B".
import { auth } from "@/auth";
import { getPool } from "@/lib/db";
import { puede, type Cap } from "@/lib/permisos";
import { rolElegidoEnPruebas } from "@/lib/rol_pruebas";

// `operador` = todo el trabajo diario (clasificar, retenciones, pagos, intake,
// maestros) SIN las dos cosas del decisor: administrar usuarios y quitar un pago.
// Decisión de Daniel (2026-09-10): él es el decisor máximo y el único admin.
export type Rol = "conciliador" | "pagador" | "causador" | "operador" | "admin";
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
  // Fail-closed: en Vercel (prod) el default es 'google'; solo local cae a 'dev'.
  const mode = process.env.AUTH_MODE ?? (process.env.VERCEL ? "google" : "dev");

  if (mode === "dev") {
    return {
      email: process.env.DEV_USER_EMAIL ?? "dev@localhost",
      // El selector del ambiente manda también en local: así se prueba lo mismo
      // que se despliega, en vez de un camino que solo existe en la máquina.
      rol: (await rolElegidoEnPruebas()) ?? (process.env.DEV_USER_ROL as Rol) ?? "admin",
    };
  }

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  // SOLO en el ambiente de pruebas se puede mirar el portal con otro rol (ver
  // lib/rol_pruebas.ts). En producción devuelve null sin siquiera leer la
  // cookie, así que esta línea no cambia nada de lo que ya pasaba.
  const elegido = await rolElegidoEnPruebas();
  const rol = elegido ?? (await rolDe(email));
  // Desactivado en Configuración = no entra, aunque su dominio esté permitido.
  // Antes un @manelfoods.com desactivado caía al default del dominio (admin) y
  // seguía operando como si nada: así trabajó `prueba@` en producción.
  if (!rol) return null;
  return { email, rol };
}

/** Rol del correo. (1) Si está en `usuarios`, ese rol MANDA; desactivado =
 *  null (no entra). (2) Si no está, todo @manelfoods.com es OPERADOR: hace el
 *  trabajo diario, no administra usuarios ni quita pagos — eso es del decisor,
 *  que se da de alta como admin en Configuración. (3) Cualquier otro cae al
 *  mínimo. */
async function rolDe(email: string): Promise<Rol | null> {
  try {
    const r = await getPool().query<{ rol: Rol; activo: boolean }>(
      "SELECT rol, activo FROM usuarios WHERE email = $1",
      [email]
    );
    if (r.rowCount && r.rows[0]) return r.rows[0].activo ? r.rows[0].rol : null;
  } catch {
    // base ausente o error transitorio -> sigue a los defaults (no bloquea el login)
  }
  if (email.toLowerCase().endsWith("@manelfoods.com")) return "operador";  // equipo interno
  return DEFAULT_ROL;
}

/** ¿El rol tiene al menos el permiso pedido? admin puede todo. (Legado — el
 *  enforcement nuevo es por capacidad: `exigirCap` / lib/permisos.) */
export function tienePermiso(rol: Rol, requerido: Rol): boolean {
  return rol === "admin" || rol === requerido;
}

/** SERVIDOR: exige una capacidad (ver lib/permisos) o lanza. Devuelve el usuario
 *  autenticado. Úsala al inicio de cada server action y route handler que muta o
 *  exporta datos. La UI oculta lo mismo por comodidad, pero ESTO es la seguridad. */
export async function exigirCap(cap: Cap): Promise<Usuario> {
  const u = await getCurrentUser();
  if (!puede(u.rol, cap)) throw new Error(`No autorizado (falta permiso: ${cap}).`);
  return u;
}
