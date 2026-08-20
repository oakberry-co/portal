// EL NIT, Y SU DÍGITO DE VERIFICACIÓN.
//
// En Colombia el NIT se escribe de dos formas y las dos son "correctas":
// 901675059 y 901.675.059-9. La DIAN emite las facturas con la primera; la gente
// carga a mano la segunda. Para un humano son el mismo proveedor; para un
// `JOIN ... ON a.nit = b.nit` no lo son — y el proveedor desaparece del archivo
// del banco sin un solo error en pantalla (pasó: MODAL TRACK, $37 millones).
//
// La clave canónica de la casa es el NIT **sin** dígito de verificación, que es
// como llegan las facturas y como está el maestro de proveedores.

export const soloDigitos = (t: string | null | undefined): string =>
  (t ?? "").replace(/\D/g, "");

/** Dígito de verificación DIAN de un NIT (algoritmo oficial, pesos fijos). */
export function digitoVerificacion(nitSinDV: string): string {
  const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const n = soloDigitos(nitSinDV).padStart(15, "0");
  let s = 0;
  for (let i = 0; i < 15; i++) s += Number(n[14 - i]) * PESOS[i];
  const r = s % 11;
  return String(r < 2 ? r : 11 - r);
}

/** Quita el dígito de verificación SOLO si de verdad lo es.
 *
 *  Ojo con la tentación de "quitar el último dígito si son 10": una cédula de 10
 *  dígitos tiene ~9% de probabilidad de que su último dígito sea, por
 *  casualidad, el DV de los 9 anteriores. Por eso además se exige que venga
 *  escrito como NIT con guion o punto, o que el llamador ya sepa que es un NIT. */
export function nitCanonico(t: string | null | undefined): string {
  const bruto = (t ?? "").trim();
  const d = soloDigitos(bruto);
  if (d.length < 10) return d;
  // '901.675.059-9' o '901675059-9': el guion dice explícitamente dónde va el DV.
  const conGuion = bruto.match(/^([\d.\s]+)-\s*(\d)\s*$/);
  if (conGuion) {
    const base = soloDigitos(conGuion[1]);
    if (digitoVerificacion(base) === conGuion[2]) return base;
  }
  return d;
}

/** ¿Estos dos documentos son el mismo? Tolera el dígito de verificación pegado
 *  en cualquiera de los dos lados, pero SOLO si el dígito es el correcto. */
export function mismoNit(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = soloDigitos(a), y = soloDigitos(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [corto, largo] = x.length < y.length ? [x, y] : [y, x];
  return largo.length === corto.length + 1
      && largo.startsWith(corto)
      && digitoVerificacion(corto) === largo.slice(-1);
}
