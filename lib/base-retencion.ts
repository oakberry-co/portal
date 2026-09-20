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

/** LA TARIFA CON LA QUE ABRE EL MODAL, del más confiable al menos:
 *
 *   1. lo ya confirmado en ESTA factura (aunque sea 0: "no retiene" es decisión);
 *   2. la tarifa que el contador fijó o viene practicando con ESTE proveedor
 *      (maestro de retenciones; también puede ser "0");
 *   3. lo que el equipo practica para ESTE concepto;
 *   4. la propuesta del pipeline (aprendida de Siigo), y SOLO si es mayor que 0.
 *
 * Hasta el 20-sep-2026 el pipeline iba SEGUNDO y su "$0" —su error más común,
 * el 43% de las veces— se leía como una decisión: el modal abría en 0% y nunca
 * llegaba a mirar la tarifa aprendida del contador. En 115 facturas el contador
 * tecleó a mano una tarifa que el portal ya sabía. La regla de la casa es que su
 * número manda; por eso lo que se aprende de él va antes que lo de Siigo, y un
 * cero del pipeline no cuenta como propuesta. */
export function tarifaInicial(a: {
  confirmado: string | number | null | undefined;   // monto ya confirmado en la factura
  base: number;                                     // sobre qué se calcula (subtotal o IVA)
  tarifaProveedor?: string | null;                  // maestro_retenciones (fijada o practicada)
  reglaConcepto?: { aplica: boolean; tarifa: string | null } | null;
  sugerido?: string | number | null;                // propuesta del pipeline (monto)
}): string {
  const pct = (amt: string | number | null | undefined) => {
    if (amt == null || amt === "" || Math.abs(a.base) <= 0) return "";
    return String(+((Math.abs(Number(amt)) / Math.abs(a.base)) * 100).toFixed(3));
  };
  const confirmado = pct(a.confirmado);
  if (confirmado !== "") return confirmado;
  if (a.tarifaProveedor != null && a.tarifaProveedor !== "") return String(a.tarifaProveedor);
  if (a.reglaConcepto) return a.reglaConcepto.aplica ? (a.reglaConcepto.tarifa ?? "") : "0";
  return Number(a.sugerido) > 0 ? pct(a.sugerido) : "";
}

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
