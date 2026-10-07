// FINANZAS — lo que comparten las pantallas del P&L al día (puro: sin base).
//
// El P&L se calcula en BigQuery (datawarehouse/finanzas/pnl) y llega a Neon como
// foto (scripts/sync_finanzas.py, tablas fin_*). Acá solo hay formato y lectura.
// Regla de la casa: una cifra estimada o devengada NUNCA se ve igual que una
// real — por eso `claseMetodo` y la etiqueta corta del método viajan con el dato.

export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Primer día del mes de una fecha que viene de Postgres (Date o 'YYYY-MM-DD'). */
export function mesIso(d: string | Date): string {
  if (typeof d === "string") return d.slice(0, 7) + "-01";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
export function diaIso(d: string | Date): string {
  if (typeof d === "string") return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** 'oct-26' */
export function etiquetaMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]}-${mes.slice(2, 4)}`;
}

/** Millones con un decimal, signo y separador colombiano: 12,3 · −4,5 · — */
export function mm(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "0";
  const s = (Math.abs(n) / 1_000_000).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (n < 0 ? "−" : "") + s;
}
export function pct(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n)} %` : "—";
}

/** real → sin marca · teórico/devengado/estimado → cursiva gris. */
export function claseMetodo(metodo: string | null | undefined): string {
  if (!metodo) return "";
  return /^real/.test(metodo) ? "" : "fin-est";
}
/** La palabra que se muestra junto al valor cuando no es real. */
export function marcaMetodo(metodo: string | null | undefined): string {
  if (!metodo) return "";
  if (/^real/.test(metodo)) return "";
  if (/^teorico/.test(metodo)) return "teórico";
  if (/^devengado/.test(metodo)) return "devengado";
  if (/^estimado/.test(metodo)) return "estimado";
  return "";
}

export const SHORT_CODE_OK = /^[A-Z]{3}_TP_[A-Za-z0-9]+$/;
