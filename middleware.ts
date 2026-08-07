// Protege TODAS las rutas con la sesión de Auth.js (ver callback `authorized`
// en auth.ts). Sin sesión -> redirige a /login. Se excluyen los endpoints de
// auth y los estáticos de Next.
export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
