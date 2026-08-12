// =============================================================================
//  Auth.js (NextAuth v5) — login con Google, restringido a Oakberry (Node).
//  Este módulo corre en Node (rutas /api/auth + getCurrentUser en lib/auth.ts) y
//  SÍ puede tocar la base. Hace spread de `auth.config.ts` (edge-safe) y le añade
//  el callback `signIn`, que es la COMPUERTA DE ACCESO.
//
//  Compuerta de acceso (2 capas):
//   1) signIn -> puede autenticar quien esté en la allowlist de env (bootstrap)
//      O activo en la tabla `usuarios` (FUENTE DE VERDAD; se administra desde la
//      base, sin editar Vercel ni redeploy — un INSERT y ya).
//   2) tabla `usuarios` -> también define el ROL de cada correo (ver lib/auth.ts).
//
//  El middleware NO usa este archivo (usaría `pg` en el Edge y rompería); usa
//  `auth.config.ts` directamente. Ver middleware.ts.
// =============================================================================
import NextAuth from "next-auth";
import { authConfig, emailEnAllowlist } from "@/auth.config";
import { getPool } from "@/lib/db";

/** ¿El correo está ACTIVO en la tabla `usuarios`? Fuente de verdad del acceso.
 *  try/catch: si la base no responde, NO tumba el login de la allowlist de env. */
async function emailEnUsuarios(email: string): Promise<boolean> {
  try {
    const r = await getPool().query(
      "SELECT 1 FROM usuarios WHERE lower(email) = $1 AND activo LIMIT 1",
      [email.toLowerCase()],
    );
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Compuerta 1: allowlist de env (bootstrap de admins) O activo en `usuarios`.
    // Cualquier otro correo, rechazado.
    async signIn({ user, profile }) {
      const email = (profile?.email ?? user?.email ?? "").toLowerCase();
      if (!email) return false;
      if (emailEnAllowlist(email)) return true;
      return await emailEnUsuarios(email);
    },
  },
});
