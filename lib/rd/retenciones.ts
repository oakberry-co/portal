// RETENCIONES DE LA EMPRESA DE RD — la PROPUESTA, no la decisión.
//
// Módulo PURO. Calcula lo que se le propone a quien aprueba; quien aprueba la
// confirma (aunque sea cero) y SOLO lo confirmado viaja al pago. Es el mismo
// modelo de Colombia (retencion_ok): aprobar sin definir la retención es pagar
// el BRUTO, y lo pagado de más no se devuelve solo.
//
// Las tasas viven acá con VIGENCIA y con su fuente, para que el día que cambien
// se agregue una fila en vez de pisar la anterior (así se puede rehacer el
// cálculo de un mes viejo con la regla de su mes).
//
// ⚠ POR CONFIRMAR CON EL CONTADOR DE RD (decisión abierta, 2026-11-12):
//   · Persona FÍSICA: ISR 10 % del valor del servicio (Código Tributario, art.
//     309: honorarios y servicios no ejecutados en relación de dependencia) y,
//     si factura ITBIS, retención del 100 % del ITBIS (Norma General 07-2007).
//   · Persona JURÍDICA: la propuesta es 0 / 0 — no se conoce todavía qué
//     servicios le retiene la empresa (p. ej. el 30 % de ITBIS de la Norma
//     02-2005). La bandeja lo dice en vez de inventar.
// Mientras `confirmada` sea false, la tarjeta muestra el aviso.

import { centavos } from "@/lib/rd/catalogo";

export type TipoPersona = "fisica" | "juridica";

type Regla = {
  desde: string;                 // AAAA-MM-DD, inclusive
  isrFisica: number; itbisFisica: number;
  isrJuridica: number; itbisJuridica: number;
  fuente: string;
  confirmada: boolean;
};

export const REGLAS_RD: Regla[] = [
  { desde: "2026-01-01",
    isrFisica: 0.10, itbisFisica: 1.00,
    isrJuridica: 0, itbisJuridica: 0,
    fuente: "CT art. 309 (ISR 10 % servicios de personas físicas) · NG 07-2007 (100 % ITBIS facturado por personas físicas)",
    confirmada: false },
];

/** La regla vigente en una fecha. Sin regla para la fecha = ERROR, nunca un
 *  default (Regla 6: un lookup de dinero no degrada en silencio a 0 %). */
export function reglaEn(fecha: string): Regla {
  const r = [...REGLAS_RD].sort((a, b) => b.desde.localeCompare(a.desde)).find((x) => x.desde <= fecha);
  if (!r) throw new Error(`No hay regla de retención de RD vigente para ${fecha}. Agrégala en lib/rd/retenciones.ts.`);
  return r;
}

export type Propuesta = {
  isrTasa: number; isrMonto: number;
  itbisTasa: number; itbisMonto: number;
  neto: number;
  confirmada: boolean; fuente: string;
  aviso: string | null;
};

/** Lo que se le propone retener a un cobro.
 *  `valor` = valor del servicio SIN ITBIS · `itbis` = ITBIS que trae la factura. */
export function propuesta(tipo: TipoPersona, valor: number, itbis: number, fecha: string): Propuesta {
  const r = reglaEn(fecha);
  const isrTasa = tipo === "fisica" ? r.isrFisica : r.isrJuridica;
  const itbisTasa = tipo === "fisica" ? r.itbisFisica : r.itbisJuridica;
  const isrMonto = centavos(valor * isrTasa);
  const itbisMonto = centavos(itbis * itbisTasa);
  let aviso: string | null = null;
  if (tipo === "juridica") aviso = "Persona jurídica: todavía no hay regla confirmada. Escribe lo que indique el contador de RD (puede ser 0).";
  else if (!r.confirmada) aviso = "Tasas propuestas, pendientes de confirmar con el contador de RD.";
  return { isrTasa, isrMonto, itbisTasa, itbisMonto,
           neto: netoAPagar(valor, itbis, isrMonto, itbisMonto),
           confirmada: r.confirmada, fuente: r.fuente, aviso };
}

/** Lo que de verdad se transfiere: valor + ITBIS facturado − lo retenido.
 *  Una sola fórmula para la pantalla, el servidor, el export y el centinela de
 *  datos (`rd_cc_neto_descuadrado`): si difieren, el 606 y el banco no cuadran. */
export function netoAPagar(valor: number, itbis: number, isr: number, itbisRet: number): number {
  return centavos(valor + itbis - isr - itbisRet);
}

/** Valida lo que confirma quien aprueba. Devuelve el motivo o null. */
export function problemaRetencion(valor: number, itbis: number, isr: number, itbisRet: number): string | null {
  for (const [n, v] of [["El ISR retenido", isr], ["El ITBIS retenido", itbisRet]] as const) {
    if (!Number.isFinite(v) || v < 0) return `${n} tiene que ser un número de cero en adelante.`;
  }
  if (isr > valor) return "El ISR retenido no puede ser mayor que el valor del servicio.";
  if (itbisRet > itbis) return "El ITBIS retenido no puede ser mayor que el ITBIS facturado.";
  if (netoAPagar(valor, itbis, isr, itbisRet) <= 0) return "Con esas retenciones no queda nada por pagar: revísalas.";
  return null;
}
