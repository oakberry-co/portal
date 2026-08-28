// EL PREFIJO DEL AMBIENTE.
//
// El portal de pruebas vive bajo `/pruebas` del mismo dominio. Next agrega ese
// prefijo solo en `<Link>` y en `redirect()` — en un `<a href="/...">` pelado NO,
// y este portal usa `<a>` en todas partes. Sin esto, en el ambiente de pruebas
// haces clic en "Maestros" y **te saca a producción sin avisar**: la pantalla se
// ve igual, la franja desaparece y ya estás editando los datos de verdad.
//
// Regla: TODO enlace interno pasa por `ruta()`. El centinela
// `scripts/test_enlaces_basepath.js` no deja agregar uno que no lo haga.
// En producción `BASE` es "" y `ruta()` devuelve lo mismo que recibió.

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefija el ambiente a un enlace interno. Deja intactos los externos
 *  (http…, mailto:, //…) y los anclas (#). */
export function ruta(p: string | null | undefined): string {
  const s = p ?? "";
  if (!s.startsWith("/") || s.startsWith("//")) return s;
  return BASE + s;
}
