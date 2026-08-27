// LA BASE SOBRE LA QUE SE RETIENE — módulo puro, para poder probarlo.
//
// Nace de traer al portal la ESPINA DIAN (2026-08-27): facturas que la DIAN
// reportó y cuyo XML nunca llegó al correo. De esas conocemos el valor total
// pero NO el subtotal, y `num(null)` lo entrega como 0.
//
// El camino que mentía: el contador abría el modal, escribía "2,5 %" y el valor
// salía en $0 —porque 0 × 2,5 % = 0— sin un solo aviso. La factura se pagaba
// completa y la retención nunca se practicaba. Es la misma familia de bug que
// "vacío no es cero" del Excel de retenciones.
//
// La regla: cuando no hay documento, la base SE ESCRIBE leyéndola del papel
// (igual que la cuenta bancaria se escribe en vez de adivinarse), y no se deja
// confirmar una tarifa que se aplicaría sobre nada.

/** Solo dígitos. En Colombia el punto separa miles, así que se descarta todo lo
 *  que no sea número en vez de intentar interpretar decimales. */
export const soloDigitos = (v: string | null | undefined): number =>
  Number(String(v ?? "").replace(/[^\d]/g, "")) || 0;

/** Monto de una retención. Redondeo a peso: no existe media unidad de moneda. */
export const montoRetencion = (base: number, tarifaPct: string | number): number =>
  Math.round((base * (Number(tarifaPct) || 0)) / 100);

/**
 * ¿Hay una tarifa escrita que se aplicaría sobre una base que no conocemos?
 *
 * Se traba SOLO en ese caso. Declarar que un proveedor **no retiene** (0 %) es
 * una decisión válida y no necesita base: trabarla ahí sería estorbar sin
 * proteger nada.
 */
export function faltaBase(a: {
  baseRf: number;      // base de ReteFuente y ReteICA (el subtotal)
  baseIva: number;     // base de ReteIVA (el IVA del documento)
  rf: string | number;
  ri: string | number;
  ric: string | number;
}): boolean {
  const positivo = (t: string | number) => (Number(t) || 0) > 0;
  return (
    (a.baseRf <= 0 && (positivo(a.rf) || positivo(a.ric))) ||
    (a.baseIva <= 0 && positivo(a.ri))
  );
}
