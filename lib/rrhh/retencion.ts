// RETENCIÓN EN LA FUENTE POR INGRESOS LABORALES — PROCEDIMIENTO 1 (art. 383 ET).
//
// Función PURA, mensual. Se liquida sobre los pagos laborales del MES: en la
// 2ª quincena se suman los de la 1ª (lo hace app/(nomina)/nomina/quincena/_nomina.ts)
// y la retención entra como deducción de la 2ª quincena.
//
//   ingresoNeto   = pagos laborales del mes − ingresos no constitutivos de renta
//                   (aportes OBLIGATORIOS del trabajador: salud, pensión, FSP)
//   subtotal      = ingresoNeto − deducciones − otras rentas exentas
//   exenta 25 %   = 25 % del subtotal (num. 10 art. 206 ET), tope 790 UVT/año ÷ 12
//   beneficios    = deducciones + otras exentas + exenta 25 %, con TOPE GLOBAL
//                   min(40 % del ingresoNeto, 1.340 UVT/año ÷ 12) (Ley 2277/2022,
//                   art. 336 ET). Si se pasa, se recorta la exenta del 25 %.
//   base          = ingresoNeto − beneficios (en UVT → tabla art. 383)
//   retención     = impuesto en UVT × UVT, redondeado al múltiplo de 1.000 más cercano.
//
// Tabla art. 383 (UVT): 0–95: 0 · >95–150: 19 % del exceso sobre 95 ·
// >150–360: 28 % sobre 150 + 10 · >360–640: 33 % sobre 360 + 69 ·
// >640–945: 35 % sobre 640 + 162 · >945–2.300: 37 % sobre 945 + 268 ·
// >2.300: 39 % sobre 2.300 + 770.
//
// FUERA (TODO): dependientes, intereses de vivienda, medicina prepagada y
// aportes voluntarios (entran por `deducciones` / `rentasExentasOtras` cuando
// la ficha los tenga); la exención de cesantías e intereses del num. 4 art. 206
// (hoy los intereses de cesantías entran como pago gravado — VERIFICAR);
// procedimiento 2.

export const TABLA_383: { desde: number; hasta: number; pct: number; masUvt: number }[] = [
  { desde: 0, hasta: 95, pct: 0, masUvt: 0 },
  { desde: 95, hasta: 150, pct: 19, masUvt: 0 },
  { desde: 150, hasta: 360, pct: 28, masUvt: 10 },
  { desde: 360, hasta: 640, pct: 33, masUvt: 69 },
  { desde: 640, hasta: 945, pct: 35, masUvt: 162 },
  { desde: 945, hasta: 2300, pct: 37, masUvt: 268 },
  { desde: 2300, hasta: Infinity, pct: 39, masUvt: 770 },
];
export const EXENTA_25_TOPE_UVT_ANUAL = 790;
export const TOPE_GLOBAL_UVT_ANUAL = 1340;
export const TOPE_GLOBAL_PCT = 40;

/** Impuesto en UVT para una base en UVT (tabla art. 383). */
export function impuestoUvt(baseUvt: number): number {
  if (!(baseUvt > 95)) return 0;
  const t = TABLA_383.find((x) => baseUvt > x.desde && baseUvt <= x.hasta)!;
  return (baseUvt - t.desde) * t.pct / 100 + t.masUvt;
}

/** Redondeo de la retención al múltiplo de 1.000 más cercano.
 *  VERIFICAR: es la convención usual (y la de los formularios DIAN), no hay una
 *  norma que lo imponga para la retención laboral; confirmar contra Siigo. */
export const redondeoRetencion = (x: number) => Math.round(x / 1000) * 1000;

export type EntradaRetencion = {
  pagosLaborales: number;         // todo lo devengado en el mes (salario, recargos, extras, auxilio, prima, incentivos…)
  aportesObligatorios: number;    // salud 4 % + pensión 4 % + FSP del trabajador, del mes
  uvt: number;                    // UVT del AÑO (motor.uvtDe): sin UVT no se calcula
  deducciones?: number;           // dependientes, vivienda, prepagada (aún no se capturan)
  rentasExentasOtras?: number;    // AFC/FVP, etc. (aún no se capturan)
};
export type ResultadoRetencion = {
  ingresoNeto: number; exenta25: number; beneficios: number; topeGlobal: number; recortadoPorTope: boolean;
  base: number; baseUvt: number; impuestoUvt: number; retencion: number;
};

export function retencionMensual(x: EntradaRetencion): ResultadoRetencion {
  if (!(x.uvt > 0)) throw new Error("Retención en la fuente sin UVT del año: agrega la UVT a REGLAS (lib/rrhh/motor.ts).");
  for (const [k, v] of Object.entries(x)) if (typeof v === "number" && (!Number.isFinite(v) || v < 0)) throw new Error(`Retención: ${k} inválido (${v}). Los valores van en positivo.`);
  const ded = x.deducciones ?? 0, otras = x.rentasExentasOtras ?? 0;
  const ingresoNeto = Math.max(0, x.pagosLaborales - x.aportesObligatorios);
  const subtotal = Math.max(0, ingresoNeto - ded - otras);
  const exenta25Sin = Math.min(subtotal * 0.25, EXENTA_25_TOPE_UVT_ANUAL * x.uvt / 12);
  const topeGlobal = Math.min(ingresoNeto * TOPE_GLOBAL_PCT / 100, TOPE_GLOBAL_UVT_ANUAL * x.uvt / 12);
  const pedido = ded + otras + exenta25Sin;
  const beneficios = Math.min(pedido, topeGlobal);
  const exenta25 = Math.max(0, exenta25Sin - Math.max(0, pedido - topeGlobal));
  const base = Math.max(0, ingresoNeto - beneficios);
  const baseUvt = base / x.uvt;
  const imp = impuestoUvt(baseUvt);
  return {
    ingresoNeto: Math.round(ingresoNeto), exenta25: Math.round(exenta25), beneficios: Math.round(beneficios), topeGlobal: Math.round(topeGlobal),
    recortadoPorTope: pedido > topeGlobal, base: Math.round(base), baseUvt: Math.round(baseUvt * 100) / 100, impuestoUvt: Math.round(imp * 100) / 100,
    retencion: redondeoRetencion(imp * x.uvt),
  };
}
