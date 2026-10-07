// EL MES DEL GASTO — a qué mes pertenece lo que dice la factura (§27 del esquema).
//
// Siigo registra cada compra con la fecha de la factura. El arriendo lo cobra el
// centro comercial anticipado los primeros días y cae en su mes; la energía, el
// agua y el aseo se facturan vencidos entre el 4 y el 10 del mes siguiente y
// entran al mes equivocado. Nadie lo notaba porque el cierre contable tarda
// semanas. El P&L al día de finanzas necesita que cada gasto sepa a qué mes
// pertenece, no cuándo lo facturaron (regla nueva de contabilidad, 7-oct-2026).
//
// Este módulo es PURO (fechas y etiquetas, sin base): lo importa la fila de
// Conciliación en el navegador. La escritura vive en periodo-gasto-db.ts.

/** Un mes como 'YYYY-MM-01' (primer día). Las fechas DIAN son DÍAS, no
 *  instantes: si llega un Date se leen sus partes locales, igual que hace la
 *  grilla con `getDate()`, y no `toISOString()`, que en UTC-5 lo correría un día. */
export function mesDe(fecha: string | Date): string {
  if (typeof fecha === "string") return fecha.slice(0, 7) + "-01";
  const y = fecha.getFullYear(), m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function sumarMeses(mes: string, n: number): string {
  const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

/** Meses entre el mes de emisión y el mes del gasto (negativo = el gasto es anterior). */
export function offsetEntre(mesEmision: string, periodo: string): number {
  return (Number(periodo.slice(0, 4)) - Number(mesEmision.slice(0, 4))) * 12
       + (Number(periodo.slice(5, 7)) - Number(mesEmision.slice(5, 7)));
}

/** Hasta dónde se deja mover el mes: seis atrás (un servicio que llegó muy
 *  tarde) y uno adelante (un arriendo anticipado). Más lejos es error de dedo
 *  o un caso para el contador, no un clic. Mismo rango que el CHECK de la base. */
export const OFFSET_MIN = -6;
export const OFFSET_MAX = 1;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** 'sep-26' */
export function etiquetaMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]}-${mes.slice(2, 4)}`;
}

/** Lo que se ofrece en la fila: de tres meses antes a uno después de la emisión,
 *  más el que ya esté puesto si se sale de ese rango (para que se vea). */
export function opcionesPeriodo(fechaEmision: string | Date, actual?: string | null): string[] {
  const base = mesDe(fechaEmision);
  const out = [-3, -2, -1, 0, 1].map((n) => sumarMeses(base, n));
  if (actual && !out.includes(actual)) out.unshift(actual);
  return out;
}

export function esMes(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-01$/.test(s);
}
