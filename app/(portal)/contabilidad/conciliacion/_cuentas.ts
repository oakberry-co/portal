// LAS CUENTAS DE UNA FACTURA — lo que se le retiene, lo que la rebaja y lo que
// se le paga. Una sola definición para la fila de la tabla (FacturaCard) y para
// la revisión en fila (cola/): si cada pantalla sacara su propio "se le paga",
// el día que difieran el equipo deja de creerle a las dos.
import type { FacturaRow } from "./FacturaCard";

export const num = (s: string | number | null | undefined) => (s != null && s !== "" ? Number(s) : 0);

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
export const copN = (n: number) => cop.format(Math.round(n || 0));

export const DIA_MS = 86_400_000;
/** Días que lleva la factura en el portal: desde que llegó (o desde la emisión si no hay llegada). */
export function diasEnPortal(f: Pick<FacturaRow, "sincronizado_en" | "fecha_emision">, ahora = Date.now()): number {
  return Math.floor((ahora - new Date(f.sincronizado_en ?? f.fecha_emision).getTime()) / DIA_MS);
}
/** Umbral de atraso crítico: una factura por clasificar que lleva más de esto
 *  en el portal ya está retrasando su pago y su causación. */
export const ATRASO_CRITICO_DIAS = 15;
/** Ventana de trabajo del tablero y de la revisión en fila. En producción hay
 *  ~3.700 "por clasificar", casi todas herencia del Google Sheet (antes de
 *  junio) que nadie va a tocar: contarlas convierte el tablero en ruido y
 *  pondría lo viejo de primero en la fila (decisión de Daniel, 24-oct-2026). */
export const VENTANA_DIAS = 60;
export function enVentana(f: Pick<FacturaRow, "sincronizado_en" | "fecha_emision">, ahora = Date.now()): boolean {
  return diasEnPortal(f, ahora) <= VENTANA_DIAS;
}

export function cuentasDe(f: FacturaRow) {
  const total = num(f.total);
  const subtotal = num(f.subtotal);
  const iva = num(f.iva);
  const esNota = f.doc_tipo === "CreditNote";
  // Lo confirmado si existe; si no, la propuesta (se marca como tal en pantalla).
  const retenTotal = f.retencion_ok && f.reten_total != null
    ? num(f.reten_total)
    : num(f.retefuente_sug) + num(f.reteiva_sug) + num(f.reteica_sug);
  const otros = num(f.otros_valor);            // con signo: negativo = adicional a favor del proveedor
  const notaCredito = Number(f.nc_aplicada ?? 0);
  // Nunca baja de cero: una nota mayor que la factura genera saldo a favor, no un pago negativo.
  const valorAPagar = Math.max(0, total - retenTotal - otros - notaCredito);
  return { total, subtotal, iva, esNota, retenTotal, otros, notaCredito, valorAPagar };
}
