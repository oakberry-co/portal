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

export function refDe(tipo: string, id: number): string {
  const p = tipo === "servicio_publico" ? "SP" : tipo === "otro" ? "OT" : "CC";
  return `${p}-${id}`;
}

const RE_REF = /^(CC|SP|OT)-(\d+)$/i;

export const esRefNoDian = (s: string): boolean => RE_REF.test((s ?? "").trim());

/** El id detrás de la referencia, o null si el texto no es una referencia. */
export function idDeRef(s: string): number | null {
  const m = RE_REF.exec((s ?? "").trim());
  return m ? Number(m[2]) : null;
}
