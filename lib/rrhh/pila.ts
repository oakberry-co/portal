// PILA — LIQUIDACIÓN DE APORTES POR COTIZANTE Y MES (función PURA).
//
// Entrada: lo devengado en el MES por la persona (las dos quincenas sumadas) y
// los días cotizados. Salida: IBC y cada aporte (trabajador / empleador).
//
//  · IBC = devengado SALARIAL del mes (básico + recargos + extras + pago de
//    incapacidades/vacaciones/licencias), SIN auxilio de transporte, SIN prima ni
//    intereses de cesantías ni pagos no salariales. Piso: 1 SMLMV proporcional a
//    los días; techo 25 SMLMV (Ley 797/2003 art. 5 — VERIFICAR).
//  · Salud 4 % trabajador + 8,5 % empleador; pensión 4 % + 12 %; FSP según
//    motor.pctFsp; ARL según clase de riesgo; CCF 4 %; SENA 2 %; ICBF 3 %.
//  · Exoneración Ley 1607/2012 (art. 114-1 ET): quien devenga < 10 SMLMV no
//    causa salud del empleador, SENA ni ICBF (motor.EXONERA_1607).
//  · REDONDEO — UN SOLO LUGAR (abajo): IBC al peso SUPERIOR; cada cotización al
//    múltiplo de 100 SUPERIOR. Es la convención del Decreto 1990/2016 que aplican
//    los operadores — VERIFICAR contra la planilla real del operador.
//
// TODO (archivo plano Res. 2388/2016): falta el layout del operador — registro
// tipo 1 (aportante: NIT, tipo de planilla E, período de pensión y de salud,
// código de operador), registro tipo 2 por cotizante (tipo/número de documento
// — la app NO tiene la cédula —, tipo de cotizante 01, códigos de EPS/AFP/ARL/
// CCF de la lista del Ministerio, novedades ING/RET/IGE/LMA/VAC/SLN/IRL con sus
// fechas, días por subsistema, tarifas, IBC y valores) y los totales. Las
// novedades por días (incapacidad, vacaciones, licencia no remunerada) hoy NO
// separan los días por subsistema: aquí todos los días pagados cotizan igual.
import { EXONERA_1607, pctFsp, CARGA } from "./motor";

/** Tarifas ARL por clase de riesgo (Decreto 1772/1994). Solo la clase I está
 *  cargada (0,522 % = la que usa el motor hoy). Cargar otra clase requiere
 *  agregarla aquí CON SU FUENTE; una clase sin tarifa es error, no default. */
export const ARL_PCT: Record<number, number> = { 1: CARGA.arl };
/** Clase por defecto: personal de tienda (heladería/punto de venta) = riesgo I.
 *  Se aplica cuando la ficha no trae `arl_clase` (columna nueva, NULL = I). */
export const ARL_CLASE_DEFECTO = 1;

export const PCT = { saludTrab: 4, saludEmp: 8.5, pensionTrab: 4, pensionEmp: 12, ccf: CARGA.caja, sena: CARGA.sena, icbf: CARGA.icbf };
export const TOPE_IBC_SMLMV = 25;

// ---- redondeo (único lugar) ----
export const redondeoIbc = (x: number) => Math.ceil(x - 1e-9);
export const redondeoAporte = (x: number) => (x <= 0 ? 0 : Math.ceil(x / 100 - 1e-9) * 100);

export type EntradaPila = {
  empleadoId: number; nombre: string;
  salario: number;              // salario mensual de la ficha (para exoneración y FSP)
  devengadoSalarial: number;    // del mes, sin auxilio ni prestaciones
  dias: number;                 // días cotizados en el mes (convención 30; 1..30)
  arlClase?: number | null;
  smlmv: number;
};
export type AportesPila = {
  empleadoId: number; nombre: string; dias: number; ibc: number; exonerado: boolean; arlClase: number;
  saludTrab: number; saludEmp: number; pensionTrab: number; pensionEmp: number; fsp: number; arl: number; ccf: number; sena: number; icbf: number;
  totalTrabajador: number; totalEmpleador: number; total: number;
};

export function aportesPila(x: EntradaPila): AportesPila {
  if (!(x.dias >= 0 && x.dias <= 30)) throw new Error(`PILA #${x.empleadoId}: días cotizados fuera de rango (${x.dias}).`);
  if (!(x.smlmv > 0)) throw new Error("PILA sin SMLMV del año.");
  const clase = x.arlClase ?? ARL_CLASE_DEFECTO;
  const pctArl = ARL_PCT[clase];
  if (pctArl == null) throw new Error(`PILA #${x.empleadoId} (${x.nombre}): clase de riesgo ARL ${clase} sin tarifa cargada en lib/rrhh/pila.ts.`);
  const piso = x.smlmv * x.dias / 30, techo = x.smlmv * TOPE_IBC_SMLMV;
  const ibc = x.dias === 0 ? 0 : redondeoIbc(Math.min(techo, Math.max(piso, x.devengadoSalarial)));
  const exonerado = EXONERA_1607 && x.salario < 10 * x.smlmv;
  const a = (pct: number) => redondeoAporte(ibc * pct / 100);
  const r = {
    saludTrab: a(PCT.saludTrab), saludEmp: exonerado ? 0 : a(PCT.saludEmp),
    pensionTrab: a(PCT.pensionTrab), pensionEmp: a(PCT.pensionEmp),
    fsp: a(pctFsp(x.salario / x.smlmv)), arl: a(pctArl), ccf: a(PCT.ccf),
    sena: exonerado ? 0 : a(PCT.sena), icbf: exonerado ? 0 : a(PCT.icbf),
  };
  const totalTrabajador = r.saludTrab + r.pensionTrab + r.fsp;
  const totalEmpleador = r.saludEmp + r.pensionEmp + r.arl + r.ccf + r.sena + r.icbf;
  return { empleadoId: x.empleadoId, nombre: x.nombre, dias: x.dias, ibc, exonerado, arlClase: clase, ...r, totalTrabajador, totalEmpleador, total: totalTrabajador + totalEmpleador };
}
