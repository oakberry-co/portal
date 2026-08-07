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

const ALLOWED_DOMAIN = (process.env.AUTH_ALLOWED_DOMAIN ?? "manelfoods.com").toLowerCase();
const ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** ¿Este correo puede autenticar? Dominio corporativo O allowlist explícita. */
function emailPermitido(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (ALLOWED_EMAILS.includes(e)) return true;
  return e.endsWith("@" + ALLOWED_DOMAIN);
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
      // Local (AUTH_MODE=dev): sin compuerta, para desarrollar sin Google.
      if ((process.env.AUTH_MODE ?? "dev") === "dev") return true;
      const logueado = !!auth?.user;
      const enLogin = nextUrl.pathname.startsWith("/login");
      if (enLogin) return logueado ? Response.redirect(new URL("/", nextUrl)) : true;
      return logueado;
    },
  },
});
