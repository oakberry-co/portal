// MIRAR EL PORTAL CON OTRO ROL — SOLO EN EL AMBIENTE DE PRUEBAS.
//
// El portal se ve distinto según el rol (el menú de `(portal)/layout.tsx` se
// arma con `puede()`), y hasta hoy la única forma de ver esas otras vistas era
// cambiarle el rol a alguien en la tabla `usuarios` —o correr el portal en
// local con `DEV_USER_ROL`, que en un despliegue no existe—. Quien trabaja el
// front terminaba diseñando UNA de las cuatro vistas y las otras tres se
// descubrían en producción.
//
// Acá el rol se elige con una cookie. Tres cosas que la hacen segura:
//
//  1. **El candado es el ambiente, no la pantalla.** Si `AMBIENTE` no dice
//     `pruebas`, esta función devuelve null ANTES de mirar la cookie: en
//     producción la cookie no existe como concepto, no es que esté ignorada en
//     un `if` de la interfaz. Una cookie se falsifica en dos líneas de consola.
//  2. **La cookie no se cree lo que dice.** Solo pasa si es uno de los cuatro
//     roles conocidos; cualquier otra cosa cae al rol de verdad de la persona.
//  3. **Es una escalada de privilegios, a propósito.** Quien entre al ambiente
//     puede mirarse como admin. Eso solo puede existir donde nada mueve plata:
//     el archivo del banco nacido acá se delata en el nombre y el emisor de
//     correos se niega a arrancar (ver `test_aislamiento_pruebas.js`). El día
//     que el ambiente tenga un camino real hacia afuera, esto se cae con él.
import { cookies } from "next/headers";
import { EN_PRUEBAS } from "@/lib/ambiente";
import type { Rol } from "@/lib/auth";

/** Los cuatro roles, en el orden en que se muestran. */
export const ROLES: readonly Rol[] = ["admin", "causador", "conciliador", "pagador"] as const;

/** El nombre de la cookie. Cambia con el ambiente igual que la de sesión. */
export const COOKIE_ROL = "rol_pruebas";

/** ¿Es uno de los cuatro roles? La cookie llega del navegador: no se confía. */
export function esRol(v: unknown): v is Rol {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** El rol que se eligió mirar, o null si no hay elección válida.
 *  En producción devuelve null SIEMPRE, sin leer la cookie. */
export async function rolElegidoEnPruebas(): Promise<Rol | null> {
  if (!EN_PRUEBAS) return null;
  const v = (await cookies()).get(COOKIE_ROL)?.value;
  return esRol(v) ? v : null;
}
