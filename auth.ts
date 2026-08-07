// =============================================================================
//  Auth.js (NextAuth v5) — login con Google, restringido a Oakberry.
//  Opción A (esta, EN USO). La Opción B (Firebase Auth) quedó documentada en el
//  README para el futuro; el resto de la app no cambia si algún día se migra:
//  siempre pide getCurrentUser() -> { email, rol } (ver lib/auth.ts).
//
//  Compuerta de acceso (2 capas):
//   1) signIn callback  -> solo dominio corporativo + allowlist pueden autenticar.
//   2) tabla `usuarios` -> define el rol de cada correo (ver lib/auth.ts).
//
//  Variables (Vercel / .env.local):
//   AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET  (Auth.js las lee solo)
//   AUTH_ALLOWED_DOMAIN (def. manelfoods.com), AUTH_ALLOWED_EMAILS (coma-sep)
// =============================================================================
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Allowlist de correos EXACTOS (coma-separados). Es la compuerta principal.
const ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
// Dominio corporativo OPCIONAL: vacío por defecto = solo manda la allowlist.
const ALLOWED_DOMAIN = (process.env.AUTH_ALLOWED_DOMAIN ?? "").trim().toLowerCase();

/** ¿Este correo puede autenticar? Allowlist de correos (+ dominio si se define). */
function emailPermitido(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (ALLOWED_EMAILS.includes(e)) return true;
  if (ALLOWED_DOMAIN && e.endsWith("@" + ALLOWED_DOMAIN)) return true;
  return false;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" }, // JWT: necesario para verificar sesión en el middleware (edge)
  pages: { signIn: "/login" },
  callbacks: {
    // Compuerta 1: solo dominio Oakberry + allowlist. Cualquier otro, rechazado.
    signIn({ user, profile }) {
      return emailPermitido(profile?.email ?? user?.email);
    },
    // Middleware: protege TODO menos /login. Sin sesión -> Auth.js redirige a /login.
    authorized({ auth, request: { nextUrl } }) {
      // Fail-closed: en Vercel (prod) el default es 'google' (protegido); solo
      // local (sin VERCEL) cae a 'dev' = sin compuerta. Explícito siempre gana.
      if ((process.env.AUTH_MODE ?? (process.env.VERCEL ? "google" : "dev")) === "dev") return true;
      const logueado = !!auth?.user;
      const enLogin = nextUrl.pathname.startsWith("/login");
      if (enLogin) return logueado ? Response.redirect(new URL("/", nextUrl)) : true;
      return logueado;
    },
  },
});
