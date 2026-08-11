// Protege TODAS las rutas con la sesión de Auth.js (ver callback `authorized`
// en auth.ts). Sin sesión -> redirige a /login. Se excluyen los endpoints de
// auth y los estáticos de Next.
export { auth as middleware } from "@/auth";

// Las rutas de intake PÚBLICO (cuentas-de-cobro, cotizaciones) quedan fuera del
// candado: un proveedor externo entra sin login a subir su documentación.
export const config = {
  matcher: ["/((?!api/auth|cuentas-de-cobro|cotizaciones|_next/static|_next/image|favicon.ico).*)"],
};
