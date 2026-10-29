// CUÁNDO LE DEBERÍA LLEGAR LA PLATA A CADA PERSONA — lo que dice el aviso de
// WhatsApp del pago de nómina.
//
// La nómina sale de Davivienda. Entre cuentas de la misma casa (Davivienda y
// DaviPlata) el abono es inmediato; a otro banco viaja por ACH, que abona a más
// tardar el día hábil siguiente. La promesa que se le hace a la persona es la
// CONSERVADORA: si le decimos «hoy» y le llega mañana, llama a RRHH preocupada;
// si le decimos «mañana» y le llega hoy, nadie llama.
//
// Siempre se escribe la FECHA («el viernes 31 de octubre»), nunca «hoy» ni
// «mañana»: el aviso puede salir horas después de confirmar el pago (la VM lo
// manda en su ronda, y fuera de horario espera a las 6 a. m.), y un «hoy» leído
// al día siguiente es mentira.
//
// REGLA A CONFIRMAR CON DAVIVIENDA (horario de corte ACH del convenio
// empresarial). Si el banco dice que lo cargado antes de las X abona el mismo
// día, se cambia acá y solo acá.
//
// Módulo PURO (sin base ni sesión): lo prueba scripts/test_pagos_nomina.js.

import { esHabil, sumarDias, type Dia } from "./habiles";

/** Bancos donde el abono desde Davivienda es el mismo día (nombres EXACTOS de
 *  lib/bancos.ts, que es lo que guarda el maestro). */
export const MISMA_CASA = new Set(["BANCO DAVIVIENDA", "DAVIPLATA"]);

const siguienteHabil = (d: Dia): Dia => {
  let x = d;
  for (let i = 0; i < 15 && !esHabil(x); i++) x = sumarDias(x, 1);
  return x;
};

/** El día en que la persona debería ver la plata, a partir del día en que el
 *  banco ejecutó el archivo. Un pago confirmado en sábado o festivo cuenta desde
 *  el siguiente hábil (ACH no corre esos días). */
export function fechaAbono(pagadoEn: Dia, banco: string | null): Dia {
  const base = siguienteHabil(pagadoEn);
  return MISMA_CASA.has(banco ?? "") ? base : siguienteHabil(sumarDias(base, 1));
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
               "septiembre", "octubre", "noviembre", "diciembre"];

/** '2026-10-31' → 'viernes 31 de octubre'. */
export function fechaLarga(d: Dia): string {
  const w = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay();
  return `${DIAS[w]} ${+d.slice(8, 10)} de ${MESES[+d.slice(5, 7) - 1]}`;
}

/** Celular colombiano como lo pide WhatsApp: 57 + 10 dígitos empezando por 3.
 *  Acepta «320 8058309», «+57 3208058309», «573208058309». Lo que no encaja
 *  devuelve null: un número adivinado le manda el sueldo de alguien a otra
 *  persona (Regla 3). */
export function celularWa(v: unknown): string | null {
  const d = String(typeof v === "number" ? Math.round(v) : v ?? "").replace(/\D/g, "");
  if (/^3\d{9}$/.test(d)) return "57" + d;
  if (/^573\d{9}$/.test(d)) return d;
  return null;
}
