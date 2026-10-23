// PRESTACIONES SOCIALES — funciones PURAS. Las usan la liquidación de retiro
// (app/(nomina)/nomina/liquidaciones) y la nómina quincenal (prima de junio y
// diciembre, intereses de cesantías en enero, cesantías consignadas en febrero).
// Una fórmula, dos pantallas: la liquidación y la quincena no pueden diferir.
//
// Días con la convención de 30 días (fechas.dias30): semestre completo = 180,
// año completo = 360. Antes la liquidación contaba días CALENDARIO (un año
// = 365 → cesantías 1,4 % de más).
//
// SUPUESTOS (VERIFICAR contra Siigo en el backtest):
//  · Base = salario ACTUAL de la ficha + auxilio de transporte si aplica
//    (cesantías y prima SÍ llevan auxilio; vacaciones NO). No hay historial
//    salarial en la app: si el salario cambió en los últimos 3 meses, la ley
//    pide promediar (art. 253 CST) y aquí NO se promedia. Tampoco se promedian
//    los recargos/extras (salario variable): la base es el salario fijo.
//  · Cesantías/intereses del año anterior (enero/febrero) usan el salario de
//    la ficha HOY: si subió en enero, la base sale inflada → alerta en la línea.
import { dias30 } from "./fechas";

export type EmpleadoPrest = { activo_id: number; salario: number; auxilio_transporte: boolean; fecha_ingreso: string; fecha_retiro: string | null };
export type ReglasPrest = { smlmv: number; auxilio: number };

/** Auxilio de transporte: marcado en la ficha Y salario ≤ 2 SMLMV (Ley 15/1959). */
export const auxilioElegible = (e: Pick<EmpleadoPrest, "salario" | "auxilio_transporte">, r: ReglasPrest) => !!e.auxilio_transporte && e.salario <= 2 * r.smlmv;
/** Base de prima y cesantías (con auxilio si aplica). */
export const basePrestacional = (e: Pick<EmpleadoPrest, "salario" | "auxilio_transporte">, r: ReglasPrest) => e.salario + (auxilioElegible(e, r) ? r.auxilio : 0);

/** Días (convención 30) que la persona estuvo vinculada dentro de [ini, fin]. */
export function diasVinculado(e: Pick<EmpleadoPrest, "fecha_ingreso" | "fecha_retiro">, ini: string, fin: string): number {
  const desde = e.fecha_ingreso > ini ? e.fecha_ingreso : ini;
  const hasta = e.fecha_retiro && e.fecha_retiro < fin ? e.fecha_retiro : fin;
  return dias30(desde, hasta);
}

export const prima = (base: number, dias: number) => Math.round(base * dias / 360);
export const cesantias = (base: number, dias: number) => Math.round(base * dias / 360);
/** 12 % anual sobre las cesantías, prorrateado por los días del año (Ley 52/1975). */
export const interesesCesantias = (ces: number, dias: number) => Math.round(ces * 0.12 * dias / 360);
/** 15 días hábiles por año → salario × días / 720 (sin auxilio). */
export const vacacionesProporcionales = (salario: number, dias: number) => Math.round(salario * dias / 720);

export type PrestacionesQuincena = {
  prima: { dias: number; pago: number; semestre: string } | null;
  interesesCesantias: { dias: number; cesantias: number; pago: number; anio: number } | null;
  cesantiasConsignadas: { dias: number; pago: number; anio: number } | null;   // informativo: va al FONDO, no al neto
  alertas: string[];
};

/** Qué prestación periódica cae en esta quincena:
 *   · prima 1er semestre → 2ª quincena de junio (pago legal a más tardar 30-jun)
 *   · prima 2º semestre  → 1ª quincena de diciembre (a más tardar 20-dic), por el semestre completo
 *   · intereses de cesantías del año anterior → 2ª quincena de enero (a más tardar 31-ene)
 *   · cesantías del año anterior → se CONSIGNAN al fondo antes del 14-feb: quedan
 *     registradas en la 1ª quincena de febrero, fuera del neto.
 *  Quien se retira dentro del semestre/año no la recibe aquí: va en su liquidación.
 *  `rAnterior` = reglas del 31-dic del año anterior (auxilio y tope de 2 SMLMV de ese año). */
export function prestacionesDeQuincena(e: EmpleadoPrest, q: { desde: string; hasta: string }, r: ReglasPrest, rAnterior: ReglasPrest): PrestacionesQuincena {
  const out: PrestacionesQuincena = { prima: null, interesesCesantias: null, cesantiasConsignadas: null, alertas: [] };
  const y = Number(q.desde.slice(0, 4)), md = q.desde.slice(5);
  const sem = md === "06-16" ? { ini: `${y}-01-01`, fin: `${y}-06-30`, n: `${y}-S1` } : md === "12-01" ? { ini: `${y}-07-01`, fin: `${y}-12-31`, n: `${y}-S2` } : null;
  if (sem && e.fecha_ingreso <= sem.fin) {
    if (e.fecha_retiro && e.fecha_retiro <= sem.fin) out.alertas.push(`Prima ${sem.n}: se retira el ${e.fecha_retiro}, va en la liquidación`);
    else {
      const dias = diasVinculado(e, sem.ini, sem.fin);
      if (dias > 0) out.prima = { dias, pago: prima(basePrestacional(e, r), dias), semestre: sem.n };
    }
  }
  if (md === "01-16" || md === "02-01") {
    const ini = `${y - 1}-01-01`, fin = `${y - 1}-12-31`;
    const vinculadoAlCierre = e.fecha_ingreso <= fin && (!e.fecha_retiro || e.fecha_retiro > fin);
    if (vinculadoAlCierre) {
      const dias = diasVinculado(e, ini, fin);
      const ces = cesantias(basePrestacional(e, rAnterior), dias);
      if (md === "01-16") out.interesesCesantias = { dias, cesantias: ces, pago: interesesCesantias(ces, dias), anio: y - 1 };
      else out.cesantiasConsignadas = { dias, pago: ces, anio: y - 1 };
      out.alertas.push(`Cesantías ${y - 1}: base = salario de la ficha hoy (${e.salario}); si cambió en enero, ajustar antes de aprobar`);
    }
  }
  return out;
}
