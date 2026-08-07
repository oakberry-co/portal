// Autoría de cada acción. Fase 0: modo DEV sin Firebase, para correr local.
// Fase 1 (pruebas/prod): AUTH_MODE=firebase -> verificar el ID token de Firebase
// contra la tabla `usuarios` (ver README). El resto de la app no cambia: siempre
// pide getCurrentUser() y obtiene { email, rol }.

export type Rol = "conciliador" | "pagador" | "causador" | "admin";
export type Usuario = { email: string; rol: Rol };

export async function getCurrentUser(): Promise<Usuario> {
  const mode = process.env.AUTH_MODE ?? "dev";

  if (mode === "dev") {
    return {
      email: process.env.DEV_USER_EMAIL ?? "dev@localhost",
      rol: (process.env.DEV_USER_ROL as Rol) ?? "admin",
    };
  }

  // TODO Fase 1: verificar Firebase ID token (cookie de sesión) y cruzar contra
  // `usuarios`. Por ahora, fuera de dev, fallamos ruidoso en vez de asumir admin.
  throw new Error("AUTH_MODE=firebase aún no implementado (Fase 1). Usar AUTH_MODE=dev en local.");
}

/** ¿El rol tiene al menos el permiso pedido? admin puede todo. */
export function tienePermiso(rol: Rol, requerido: Rol): boolean {
  return rol === "admin" || rol === requerido;
}
