// =============================================================================
//  auth.config.ts — configuración de Auth.js SEGURA PARA EDGE (sin base de datos).
//
//  El middleware corre en el Edge Runtime y NO puede cargar `pg`. Por eso lo que
//  el middleware necesita (providers + callback `authorized`) vive AQUÍ, sin
//  ningún import de Node. La compuerta que consulta la tabla `usuarios` (Node)
//  vive en `auth.ts`, que hace spread de esta config y le añade el callback
//  `signIn`. Patrón oficial de NextAuth v5 (split edge/node).
//
//  Variables (Vercel / .env.local):
//   AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET  (Auth.js las lee solo)
//   AUTH_ALLOWED_DOMAIN (opcional), AUTH_ALLOWED_EMAILS (coma-sep, bootstrap)
// =============================================================================
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Allowlist de correos EXACTOS (coma-separados) — BOOTSTRAP: garantiza que los
// admins fundadores entren aunque la base no responda. La fuente de verdad del
// acceso es la tabla `usuarios` (ver auth.ts).
const ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
// Dominio corporativo OPCIONAL: vacío por defecto = solo mandan allowlist + tabla.
const ALLOWED_DOMAIN = (process.env.AUTH_ALLOWED_DOMAIN ?? "").trim().toLowerCase();

/** ¿El correo está en la allowlist de env (o el dominio, si se define)? Edge-safe. */
export function emailEnAllowlist(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (ALLOWED_EMAILS.includes(e)) return true;
  if (ALLOWED_DOMAIN && e.endsWith("@" + ALLOWED_DOMAIN)) return true;
  return false;
}

// EL AMBIENTE DE PRUEBAS VIVE EN EL MISMO DOMINIO (www.manelfoods.co/pruebas), y
// las cookies NO distinguen rutas por sí solas: con el nombre de siempre, entrar
// a pruebas pisaría la sesión del portal real (y al revés) — el token del otro
// ambiente no verifica contra este `AUTH_SECRET`, así que cada visita
// deslogearía a la otra. Por eso en pruebas la cookie se llama distinto y vive
// bajo `/pruebas`.
const EN_PRUEBAS = !!process.env.BASE_PATH;
const COOKIE_SESION = EN_PRUEBAS ? "authjs.session-token.pruebas" : "authjs.session-token";

export const authConfig = {
  providers: [Google],
  session: { strategy: "jwt" }, // JWT: el middleware (edge) verifica la sesión sin DB
  // El login del AMBIENTE, no el de producción. `signIn` es una ruta relativa y
  // Auth.js le pega el origen público (AUTH_URL) pero NO el prefijo: sin esto,
  // entrar a /pruebas mandaba a www.manelfoods.co/login —el portal REAL—, y de
  // vuelta al ambiente la sesión no servía (su cookie se llama distinto). Un
  // bucle sin error visible: el usuario cree que el login está roto.
  pages: { signIn: (process.env.BASE_PATH ?? "") + "/login" },
  cookies: {
    sessionToken: {
      name: (process.env.VERCEL ? "__Secure-" : "") + COOKIE_SESION,
      options: { httpOnly: true, sameSite: "lax", path: EN_PRUEBAS ? "/pruebas" : "/", secure: !!process.env.VERCEL },
    },
  },
  callbacks: {
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
} satisfies NextAuthConfig;
