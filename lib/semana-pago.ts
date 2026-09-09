// QUÉ SEMANA SE PAGA CADA FACTURA — y por qué eso decide en qué recuadro cae.
//
// El tablero de Pagos parte lo que está listo para pagar en tres: las ATRASADAS,
// las de ESTA SEMANA y los PRÓXIMOS PAGOS. Hasta sep-2026 solo había dos, y la
// segunda columna era en realidad "esta semana y todas las que vengan": el
// filtro decía `>=`. Nunca mordió porque el contador confirmaba retenciones de
// a una y cerca del vencimiento, así que a Pagos llegaba solo lo de la semana.
// El 9-sep subió 183 de golpe desde el Excel, la columna se llenó con cuatro
// semanas de facturas bajo un título que decía "esta semana", y con un clic
// sobre NUTRELLE (sin marcar ninguna = todas) se mandaron 64 a Validación —
// diez de ellas con plazo hasta la semana siguiente: $8,3M que habrían salido
// del banco 7 a 11 días antes de lo negociado con el proveedor.
//
// La regla vive acá, en UN solo lugar, y la usan la pantalla (para repartir) y
// el servidor (para negarse a mover a Validación lo que todavía no toca, salvo
// que alguien lo adelante a propósito). Dos copias de un cálculo de calendario
// es como terminan diciendo semanas distintas para el mismo día.
//
// Módulo PURO (sin base, sin sesión): lo prueba `scripts/test_semana_pagos.js`.

import { hoyBogota, sumarDias, diaSemana, type Dia } from "./habiles";

/** Si `config_pagos.dia_pago` no existe todavía: viernes. Misma cifra en la
 *  página y en la acción del servidor, para que no repartan distinto. */
export const DIA_PAGO_DEFAULT = 5;

/** Lo mínimo que hay que saber de una factura para decidir su semana. Las
 *  fechas llegan como texto 'AAAA-MM-DD' (los `::text` del SQL): se trabajan
 *  como texto y en UTC a propósito — ver el porqué en `habiles.ts`. */
export type FilaSemana = {
  fecha_emision: string;
  fecha_vencimiento: string | null;
  /** Fecha de pago PROGRAMADA a mano ("pasar a otra semana"). Manda sobre el
   *  vencimiento: alguien decidió cuándo se paga ESTA factura. */
  fecha_pago_prog?: string | null;
};

export type Cuando = "atrasada" | "esta_semana" | "proxima";

const dia = (s: string): Dia => s.slice(0, 10);

/** Fecha de pago SUGERIDA: el último "día de pago" (ISO 1=Lun..7=Dom) que no
 *  pase del vencimiento. Una factura que vence el martes se paga el miércoles
 *  ANTERIOR, no el siguiente: el siguiente ya es tarde. */
export function sugPago(vence: Dia, diaPago: number): Dia {
  const dow = diaSemana(vence) || 7;                 // 0=dom → 7, como ISO
  return sumarDias(vence, -((dow - diaPago + 7) % 7));
}

/** El día en que ESTA factura se paga. Sin vencimiento (sin plazo) se toma la
 *  emisión: una factura a la que nadie le puso plazo se trata como vencida al
 *  llegar, que es el error que se ve — el otro sentido la escondería en
 *  "próximos" para siempre. */
export function fechaPagoDe(f: FilaSemana, diaPago: number): Dia {
  if (f.fecha_pago_prog) return dia(f.fecha_pago_prog);
  return sugPago(dia(f.fecha_vencimiento ?? f.fecha_emision), diaPago);
}

/** Semana ISO "AAAA-Wss". El año va primero para que ordene como texto (la
 *  semana 53 de 2026 queda antes que la 01 de 2027). Calculada en UTC sobre la
 *  fecha escrita: un `new Date("2026-09-14")` leído en hora local se corre al
 *  domingo 13 en Bogotá y cambia de semana justo el lunes. */
export function semanaISO(d: Dia): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);            // el jueves de esa semana fija el año
  const inicio = Date.UTC(t.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((t.getTime() - inicio) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

/** El lunes de la semana de una fecha (para decir "semana del 14 al 18 sep"). */
export function lunesDe(d: Dia): Dia {
  return sumarDias(d, -((diaSemana(d) || 7) - 1));
}

/** ¿Cuándo se paga esta factura respecto a HOY? `hoy` se recibe para poder
 *  probarlo; en producción es el día de Bogotá, no el de UTC (Regla 1: a las
 *  7 p.m. de un domingo Vercel ya cree que es lunes y cambiaría de semana). */
export function cuandoSePaga(f: FilaSemana, diaPago: number, hoy: Dia = hoyBogota()): Cuando {
  const s = semanaISO(fechaPagoDe(f, diaPago));
  const h = semanaISO(hoy);
  return s < h ? "atrasada" : s === h ? "esta_semana" : "proxima";
}

/** Reparte lo listo para pagar en los tres recuadros. Cada factura cae en UNO
 *  y solo uno: la suma de los tres es la entrada. */
export function repartir<T extends FilaSemana>(filas: T[], diaPago: number, hoy: Dia = hoyBogota()):
  { atrasadas: T[]; estaSemana: T[]; proximas: T[] } {
  const r = { atrasadas: [] as T[], estaSemana: [] as T[], proximas: [] as T[] };
  for (const f of filas) {
    const c = cuandoSePaga(f, diaPago, hoy);
    (c === "atrasada" ? r.atrasadas : c === "esta_semana" ? r.estaSemana : r.proximas).push(f);
  }
  return r;
}

/** Las que TODAVÍA no tocan. Es lo que el servidor se niega a mover a
 *  Validación si nadie dijo "adelantar" — el atajo "sin marcar = todas" de la
 *  pantalla nunca puede llevárselas, ni siquiera desde una pestaña vieja. */
export function adelantadas<T extends FilaSemana>(filas: T[], diaPago: number, hoy: Dia = hoyBogota()): T[] {
  return filas.filter((f) => cuandoSePaga(f, diaPago, hoy) === "proxima");
}
