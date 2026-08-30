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
// `/completar/<token>` también: es el enlace que le mandamos por correo para que
// suba SOLO lo que falta, en vez de repetir todo el formulario. El token largo
// es la credencial, y esa página no deja cambiar valor, cuenta ni NIT.
//
// `robots.txt`, `sitemap.xml` y las tarjetas `/og/*` TAMBIÉN quedan fuera, y no
// por comodidad: si el middleware los intercepta, el crawler pide directivas,
// recibe un 307 a /login y concluye "sin directivas" -> campo libre para indexar
// los dos intakes públicos. El candado de sesión no protege lo que YA es
// público; el robots es lo que lo declara. Ver `app/robots.ts` (Disallow total).
//
// Y el LOGO, por la misma razón (bug 2026-08-18): `/oakberry-logo.png` vive en
// `public/`, o sea en la raíz — no bajo `_next/static`. El middleware lo estaba
// interceptando y devolviendo un 307 a /login, así que el navegador del
// proveedor recibía HTML donde esperaba una imagen y la landing salía con el
// logo roto. En escritorio no se veía porque quedaba cacheado de antes; en un
// celular, sin caché, se veía siempre. Cualquier asset nuevo de `public/` que
// use una página pública hay que agregarlo aquí.
//
// `pruebas` también sale del matcher, y no por comodidad: en producción esa ruta
// se REESCRIBE hacia el despliegue de pruebas (ver next.config.mjs), y el
// middleware corre ANTES que los rewrites. Si lo interceptara, mandaría a /login
// del portal real una petición que iba para el otro ambiente —que tiene su
// propio candado— y el ambiente de pruebas nunca abriría.
//
// El "/" suelto NO sobra: con `basePath`, Next le pega el prefijo al matcher, y
// el patrón de abajo pasa a exigir `/pruebas/` + algo. La portada `/pruebas` (sin
// barra final) no casaba con nada y quedaba SIN CANDADO: una pantalla del portal
// abierta a internet, sobre una copia de los libros reales. Verificado en el
// despliegue de pruebas antes de conectarlo (2026-08-29).
export const config = {
  matcher: [
    "/",
    "/((?!api/auth|pruebas|cuentas-de-cobro|cotizaciones|completar|robots.txt|sitemap.xml|og/|oakberry-logo|_next/static|_next/image|favicon.ico).*)",
  ],
};
