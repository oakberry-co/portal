// TEXTO HUMANO QUE VIAJA HASTA EL BANCO.
//
// El nombre del titular de una cuenta no es decorativo: sale en el archivo con
// el que el banco transfiere, y un nombre que no corresponde al de la cuenta es
// una fila que el banco puede rechazar.
//
// Apareció con un caso real: el apellido de un proveedor estaba guardado como
// `PEÃA` en vez de `PEÑA`. No es un error de digitación — son los DOS bytes de
// la "Ñ" en UTF-8 (C3 91) leídos como si fueran dos caracteres Latin-1: se ve
// una "Ã" seguida de un carácter de control INVISIBLE. En pantalla parece un
// nombre raro; en el archivo del banco sale `PEAA` más un control que nadie ve
// (la "Ã" pierde su tilde al quitar tildes, y el control sobrevive).
//
// Entra al copiar y pegar desde un visor de PDF o desde una hoja guardada con
// otra codificación. Por eso se limpia EN LA PUERTA (al escribir), no solo al
// exportar: si el dato entra sucio, cualquier otra pantalla que lo muestre
// también miente.

/** Caracteres de control C0 y C1: invisibles, y ninguno significa nada en un
 *  nombre. El C1 (0x80-0x9F) es justo donde caen los segundos bytes del UTF-8
 *  mal leído, así que es la huella del problema. */
// Dos copias a propósito: un regex con /g guarda `lastIndex` entre llamadas, y
// `.test()` sobre el mismo objeto devuelve true y false alternados. Es un bug
// clásico y silencioso: el centinela dejaría pasar una de cada dos filas sucias.
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001F\u007F-\u009F]/g;
// eslint-disable-next-line no-control-regex
const HAY_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** ¿Este texto parece UTF-8 leído como Latin-1? Se exige que TODO sea
 *  reinterpretable (ningún carácter por encima de 255) y que el resultado sea
 *  UTF-8 válido: si no, se deja como está. Nunca se "arregla" a la fuerza. */
export function reparaMojibake(s: string): string {
  if (!/[ÃÂ]/.test(s)) return s;                       // sin la huella, no se toca
  if ([...s].some((c) => c.codePointAt(0)! > 255)) return s;
  const bytes = Buffer.from([...s].map((c) => c.codePointAt(0)!));
  const r = bytes.toString("utf8");
  return r.includes("�") || r === s ? s : r;      // no descifró: se deja igual
}

/** Limpia un texto escrito o pegado por una persona antes de guardarlo. */
export function limpiarTextoHumano(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = reparaMojibake(String(s)).replace(CONTROLES, "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/** El correo, sin el `mailto:` que se pega solo al copiar un enlace.
 *  Un correo mal guardado no rebota: simplemente el proveedor nunca se entera
 *  de que le pagamos (Regla 18). */
export function limpiarCorreo(s: string | null | undefined): string | null {
  const t = limpiarTextoHumano(s);
  if (!t) return null;
  return t.replace(/^\s*mailto:\s*/i, "").replace(/^<|>$/g, "").trim() || null;
}

/** ¿Este texto trae basura invisible o mojibake? Lo usa el centinela. */
export function textoSucio(s: string | null | undefined): boolean {
  if (!s) return false;
  return HAY_CONTROL.test(s) || reparaMojibake(s) !== s;
}
