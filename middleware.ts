// Protege TODAS las rutas con la sesión de Auth.js. Sin sesión -> redirige a
// /login (ver callback `authorized` en auth.config.ts). Se excluyen los endpoints
// de auth y los estáticos de Next.
//
// IMPORTANTE: el middleware corre en el EDGE Runtime, que NO puede cargar `pg`.
// Por eso monta una instancia ligera desde `auth.config.ts` (sin base de datos),
// NO desde `auth.ts` (que consulta la tabla `usuarios` y es solo Node).
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

// Las rutas de intake PÚBLICO (cuentas-de-cobro, cotizaciones) quedan fuera del
// candado: un proveedor externo entra sin login a subir su documentación.
//
// `robots.txt`, `sitemap.xml` y las tarjetas `/og/*` TAMBIÉN quedan fuera, y no
// por comodidad: si el middleware los intercepta, el crawler pide directivas,
// recibe un 307 a /login y concluye "sin directivas" -> campo libre para indexar
// los dos intakes públicos. El candado de sesión no protege lo que YA es
// público; el robots es lo que lo declara. Ver `app/robots.ts` (Disallow total).
export const config = {
  matcher: [
    "/((?!api/auth|cuentas-de-cobro|cotizaciones|robots.txt|sitemap.xml|og/|_next/static|_next/image|favicon.ico).*)",
  ],
};
