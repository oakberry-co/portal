// CÓMO SE LLAMA UN DOCUMENTO SIN FACTURA DIAN, Y CÓMO SE LEE ESE NOMBRE.
//
// `CC-46` (cuenta de cobro), `SP-51` (servicio público), `OT-3` (otro gasto).
// Es el nombre con el que el equipo los menciona en la bandeja Y su LLAVE DE
// ROUND-TRIP en el Excel de retenciones: lo que sale tiene que poder volver
// (Regla 15). Estos documentos no tienen CUFE, así que esta referencia es lo
// único que los identifica cuando viajan.
//
// Módulo PURO —sin base y sin sesión— a propósito: lo usan la bandeja, el
// exportador y el importador, y una llave que solo se puede leer desde el
// servidor es una llave que no se puede probar.
//
// SE DISTINGUE DE UN CUFE POR LA FORMA, nunca adivinando: un CUFE son 96
// caracteres hexadecimales. Si una se colara como la otra, la retención de una
// cuenta de cobro se escribiría sobre una factura ajena — y el 45,7% de las
// facturas comparte NIT y total con una gemela, así que no se notaría.

// El prefijo sale de la tabla de tipos, para que agregar un tipo de gasto no
// exija acordarse de tocar este archivo. LOS PREFIJOS YA EMITIDOS NO SE CAMBIAN
// (Regla 15): `SP-51` tiene que seguir significando lo mismo dentro de un año,
// porque es la llave con la que esa fila viaja en el Excel de retenciones.
// Import RELATIVO, no "@/": este archivo lo compilan los centinelas con `tsc`
// suelto, y tsc resuelve los alias para revisar tipos pero NO los reescribe en
// el código que emite — un `require("@/lib/…")` revienta al correr el script.
import { TIPOS_GASTO } from "./gastos-periodicos";

export function refDe(tipo: string, id: number): string {
  const p = TIPOS_GASTO.find((t) => t.valor === tipo)?.pre ?? "CC";
  return `${p}-${id}`;
}

const RE_REF = new RegExp(`^(CC|${TIPOS_GASTO.map((t) => t.pre).join("|")})-(\\d+)$`, "i");

export const esRefNoDian = (s: string): boolean => RE_REF.test((s ?? "").trim());

/** El id detrás de la referencia, o null si el texto no es una referencia. */
export function idDeRef(s: string): number | null {
  const m = RE_REF.exec((s ?? "").trim());
  return m ? Number(m[2]) : null;
}
