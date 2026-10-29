// PERIODO Y CONCEPTO DE UN LOTE DE NÓMINA. Módulo puro y SIN dependencias: lo
// importan la pantalla (navegador) y el lector de Excel (servidor).

export const CONCEPTOS = ["quincena", "prima", "liquidacion", "bonificacion", "vacaciones", "otro"] as const;
export type Concepto = (typeof CONCEPTOS)[number];
export const ETIQUETA_CONCEPTO: Record<Concepto, string> = {
  quincena: "Quincena", prima: "Prima", liquidacion: "Liquidación", bonificacion: "Bonificación",
  vacaciones: "Vacaciones", otro: "Otro",
};

/** '2026-11-Q1' · '2026-11-Q2' · '2026-11'. El periodo es la llave que impide
 *  pagar dos veces la misma quincena (índice ux_nomina_lote_periodo). */
export function periodoValido(p: string): boolean {
  const m = p.match(/^(\d{4})-(\d{2})(-Q[12])?$/);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 2024 && +m[1] <= 2100;
}
export const mesDePeriodo = (p: string): string => p.slice(0, 7) + "-01";

export function etiquetaPeriodo(p: string): string {
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                 "septiembre", "octubre", "noviembre", "diciembre"];
  const mes = MESES[+p.slice(5, 7) - 1] ?? p;
  const q = p.endsWith("-Q1") ? "1ª quincena de " : p.endsWith("-Q2") ? "2ª quincena de " : "";
  return `${q}${mes} ${p.slice(0, 4)}`;
}

