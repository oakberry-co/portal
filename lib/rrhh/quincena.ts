// LÍNEA DE NÓMINA QUINCENAL — función PURA (sin base de datos), testeable.
// La usan la pantalla /nomina/quincena, el Excel para Siigo, la PILA y el
// snapshot que se guarda al aprobar (contrato v2: lib/rrhh/SNAPSHOT_V2.md).
//
// Convenciones (alineadas a Siigo, spec 04_rrhh §3.6c):
//  · Mes de 30 días (fechas.dias30): la quincena vale 15 días; el básico es
//    salario/30 × días pagados, prorrateado por ingreso/retiro.
//  · Cada día de ausencia SALE del básico y se paga (o no) en su propio concepto
//    (`ausencias[]`): así el XML de la DIAN separa sueldo trabajado, incapacidad,
//    vacaciones y licencias. Pago + descuento de cada ausencia = salario/30 × días.
//  · Incapacidad de origen COMÚN: días 1-2 al 100 % (convención Siigo de la spec),
//    desde el día 3 al 66,67 % y NUNCA por debajo del SMLMV diario (smlmv/30).
//    Con salario mínimo el descuento es 0. Origen LABORAL (ARL): 100 %.
//    El día se cuenta desde el inicio de LA SOLICITUD (una prórroga cargada como
//    solicitud nueva reinicia la cuenta — TODO: campo «prórroga de»).
//    Más de 90 días: la ley baja al 50 %; NO está implementado → alerta.
//  · Ausencias no remuneradas: se descuentan los días HÁBILES (lun-sáb sin
//    festivos), como antes; el domingo queda en el básico.
//  · Auxilio de transporte: auxilio/30 × días con derecho = días del período −
//    días de incapacidad, licencias, vacaciones y no remuneradas (catalogos.quitaAuxilio).
//    Sigue exigiendo al menos una hora trabajada en la quincena (como antes).
//  · Horas: el básico ya paga las horas ordinarias; recargos (nocturno,
//    dominical) se pagan por el % y las EXTRA por la hora completa (base + %),
//    porque no están dentro del salario fijo.
//  · Suma de control (R5): devengado − deducciones = neto, y además neto = la
//    fórmula anterior (ibc + auxilio − aportes + novedades + prestaciones −
//    retención). Si no cuadra al peso, se lanza: no se muestra ni se aprueba.
import { dias30, diasEntre, pesoDia30, rango } from "./fechas";
import { tipoAusencia } from "./catalogos";
import { pctFsp, TIPOS, TIPOS_EXTRA, type Costo, type Reglas, type TipoHora } from "./motor";
import { auxilioElegible, type PrestacionesQuincena } from "./prestaciones";

export type EmpleadoQ = { activo_id: number; nombre_completo: string; salario: number; auxilio_transporte: boolean; fecha_ingreso: string; fecha_retiro: string | null };
export type SolicitudQ = { id: number; tipo: string; desde: string; hasta: string };
export type NovedadQ = { tipo: string; descripcion: string | null; valor: number };
export type CostoQ = Pick<Costo, "horas" | "recargos" | "extrasBase" | "basePorTipo" | "recargoPorTipo"> & { trabajadas: number };

export type AusenciaV2 = { tipo: string; origen?: "comun" | "laboral"; desde: string; hasta: string; dias: number; pago: number; descuento: number };
export type HoraV2 = { cantidad: number; pct: number; pago: number };
export type NovedadV2 = { tipo: string; descripcion: string; valor: number; naturaleza: "devengado" | "deduccion" };
export type SnapshotV2 = {
  v: 2; empleadoId: number; nombre: string; desde: string; hasta: string;
  diasPagados: number; basico: number;
  horas: Partial<Record<TipoHora, HoraV2>>;
  auxilio: number;
  ausencias: AusenciaV2[];
  prima: { dias: number; pago: number } | null;
  interesesCesantias: { pago: number } | null;
  cesantiasConsignadas: { pago: number } | null;
  novedades: NovedadV2[];
  ibc: number; salud: number; pension: number; fsp: number; retencion: number;
  devengado: number; deducciones: number; neto: number;
  reglas: { desde: string; divisor: number; smlmv: number; uvt: number };
};

const NOV_DEDUCCION = new Set(["prestamo", "embargo", "descuento"]);
const NOV_DEVENGADO = new Set(["incentivo", "bonificacion"]);

/** Valora las ausencias APROBADAS que tocan la quincena (ya recortadas a la vigencia
 *  del contrato). Un día con dos solicitudes se cuenta UNA vez (la primera por fecha/id)
 *  y deja alerta. Un tipo fuera del catálogo lanza (R6). */
export function valorarAusencias(e: EmpleadoQ, q: { desde: string; hasta: string }, sols: SolicitudQ[], r: Pick<Reglas, "smlmv">, festivos: Set<string>) {
  const ini = e.fecha_ingreso > q.desde ? e.fecha_ingreso : q.desde;
  const fin = e.fecha_retiro && e.fecha_retiro < q.hasta ? e.fecha_retiro : q.hasta;
  const ausencias: AusenciaV2[] = [], alertas: string[] = [];
  if (fin < ini) return { ausencias, alertas };
  const usados = new Set<string>();
  const salDia = e.salario / 30, pisoDia = r.smlmv / 30;
  for (const s of [...sols].sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : a.id - b.id))) {
    const cat = tipoAusencia(s.tipo);
    const d0 = s.desde > ini ? s.desde : ini, d1 = s.hasta < fin ? s.hasta : fin;
    if (d1 < d0) continue;
    const todos = rango(d0, d1);
    const dias = todos.filter((d) => !usados.has(d));
    if (dias.length < todos.length) alertas.push(`Solicitud #${s.id} (${s.tipo}) se solapa con otra ausencia aprobada: el día cuenta una vez`);
    dias.forEach((d) => usados.add(d));
    if (!dias.length) continue;
    const origen = "origen" in cat ? cat.origen : undefined;
    if (!cat.remunerada) {
      const habiles = dias.filter((d) => new Date(d + "T12:00:00Z").getUTCDay() !== 0 && !festivos.has(d));
      const n = habiles.reduce((a, d) => a + pesoDia30(d), 0);
      if (n > 0) ausencias.push({ tipo: s.tipo, desde: d0, hasta: d1, dias: n, pago: 0, descuento: Math.round(e.salario * n / 30) });
      continue;
    }
    const n = dias.reduce((a, d) => a + pesoDia30(d), 0);
    if (n === 0) continue;
    const lleno = Math.round(e.salario * n / 30);
    let pago: number;
    if (origen === "comun") {
      let bruto = 0;
      for (const d of dias) {
        const idx = diasEntre(s.desde, d) + 1;
        if (idx > 90) alertas.push(`Incapacidad #${s.id}: día ${idx} (> 90): la regla del 50 % no está implementada — VERIFICAR`);
        // piso SMLMV diario; nunca más que el salario diario (VERIFICAR para salarios < SMLMV, p. ej. medio tiempo)
        const valDia = idx <= 2 ? salDia : Math.min(salDia, Math.max(salDia * cat.pct / 100, pisoDia));
        bruto += pesoDia30(d) * valDia;
      }
      pago = Math.min(lleno, Math.round(bruto));
    } else pago = Math.round(lleno * cat.pct / 100);
    ausencias.push({ tipo: s.tipo, ...(origen ? { origen } : {}), desde: d0, hasta: d1, dias: n, pago, descuento: lleno - pago });
  }
  return { ausencias, alertas: [...new Set(alertas)] };
}

export type EntradaLinea = {
  e: EmpleadoQ; q: { desde: string; hasta: string }; costo: CostoQ; sols: SolicitudQ[]; novs: NovedadQ[];
  r: Reglas; prest: PrestacionesQuincena; retencion: number; festivos: Set<string>;
};

export function lineaQuincena(a: EntradaLinea) {
  const { e, q, costo, r, prest } = a;
  if (!(e.salario > 0)) throw new Error(`#${e.activo_id} ${e.nombre_completo}: salario inválido en la ficha (${e.salario}).`);
  if (!(a.retencion >= 0)) throw new Error(`#${e.activo_id}: retención negativa (${a.retencion}).`);
  const ini = e.fecha_ingreso > q.desde ? e.fecha_ingreso : q.desde;
  const fin = e.fecha_retiro && e.fecha_retiro < q.hasta ? e.fecha_retiro : q.hasta;
  const diasBase = dias30(ini, fin);
  const { ausencias, alertas } = valorarAusencias(e, q, a.sols, r, a.festivos);
  const diasAus = ausencias.reduce((s, x) => s + x.dias, 0);
  const diasPagados = diasBase - diasAus;
  if (diasPagados < 0) throw new Error(`#${e.activo_id} ${e.nombre_completo}: ${diasAus} días de ausencia en una quincena de ${diasBase} días.`);

  const basicoTrab = Math.round(e.salario * diasPagados / 30);   // multiplicar antes de dividir: sin error de coma flotante
  const pagoAus = ausencias.reduce((s, x) => s + x.pago, 0);
  const descAus = ausencias.filter((x) => !tipoAusencia(x.tipo).remunerada).reduce((s, x) => s + x.descuento, 0);
  const descInc = ausencias.filter((x) => tipoAusencia(x.tipo).remunerada).reduce((s, x) => s + x.descuento, 0);
  const descuentos = descAus + descInc;
  const basico = basicoTrab + pagoAus + descuentos;     // salario de los días del período (v1)

  // horas: recargo (%) para nocturna/dominical; hora completa para las extra
  const horas: Partial<Record<TipoHora, HoraV2>> = {};
  for (const t of TIPOS) {
    if (t.id === "ordinaria" || t.id === "descanso" || t.id === "ausencia") continue;
    const cant = costo.horas[t.id];
    if (!cant) continue;
    const esExtra = TIPOS_EXTRA.includes(t.id);
    horas[t.id] = { cantidad: cant, pct: r.recargo[t.id], pago: (esExtra ? costo.basePorTipo[t.id] : 0) + costo.recargoPorTipo[t.id] };
  }
  const pagoHoras = Object.values(horas).reduce((s, h) => s + h!.pago, 0);
  if (pagoHoras !== costo.recargos + costo.extrasBase) throw new Error(`#${e.activo_id}: horas no cuadran (${pagoHoras} ≠ recargos ${costo.recargos} + extras ${costo.extrasBase}).`);

  const diasSinAux = ausencias.filter((x) => tipoAusencia(x.tipo).quitaAuxilio).reduce((s, x) => s + x.dias, 0);
  const diasAux = Math.max(0, diasBase - diasSinAux);
  // 249.095 × 15 / 30 = 124.547,5 → 124.548 (VERIFICAR: Oak-Crew muestra 124.547)
  const auxilio = auxilioElegible(e, r) && costo.trabajadas > 0 ? Math.round(r.auxilio * diasAux / 30) : 0;

  const ibc = basicoTrab + pagoAus + costo.recargos + costo.extrasBase;
  const salud = Math.round(ibc * 0.04), pension = Math.round(ibc * 0.04);
  const fsp = Math.round(ibc * pctFsp(e.salario / r.smlmv) / 100);

  const novedades: NovedadV2[] = [];
  for (const n of a.novs) {
    if (!Number.isInteger(n.valor) || n.valor === 0) throw new Error(`#${e.activo_id}: novedad «${n.tipo}» con valor inválido (${n.valor}).`);
    const naturaleza = n.valor > 0 ? "devengado" : "deduccion";
    if ((naturaleza === "devengado" && NOV_DEDUCCION.has(n.tipo)) || (naturaleza === "deduccion" && NOV_DEVENGADO.has(n.tipo)))
      alertas.push(`Novedad «${n.tipo}» con signo raro (${n.valor}): revisar`);
    novedades.push({ tipo: n.tipo, descripcion: n.descripcion ?? "", valor: Math.abs(n.valor), naturaleza });
  }
  const novDev = novedades.filter((n) => n.naturaleza === "devengado").reduce((s, n) => s + n.valor, 0);
  const novDed = novedades.filter((n) => n.naturaleza === "deduccion").reduce((s, n) => s + n.valor, 0);
  const novedadesNetas = a.novs.reduce((s, n) => s + n.valor, 0);

  const prima = prest.prima?.pago ?? 0, intereses = prest.interesesCesantias?.pago ?? 0;
  const retencion = a.retencion;
  const devengado = basicoTrab + pagoAus + pagoHoras + auxilio + prima + intereses + novDev;
  const deducciones = salud + pension + fsp + retencion + novDed;
  const neto = devengado - deducciones;
  // R5: dos caminos al mismo neto, al peso
  const netoFormulaAnterior = ibc + auxilio - salud - pension - fsp + novedadesNetas + prima + intereses - retencion;
  if (neto !== netoFormulaAnterior) throw new Error(`#${e.activo_id} ${e.nombre_completo}: suma de control rota (devengado − deducciones = ${neto}, fórmula = ${netoFormulaAnterior}).`);

  const v2: SnapshotV2 = {
    v: 2, empleadoId: e.activo_id, nombre: e.nombre_completo, desde: q.desde, hasta: q.hasta,
    diasPagados, basico: basicoTrab, horas, auxilio, ausencias,
    prima: prest.prima ? { dias: prest.prima.dias, pago: prest.prima.pago } : null,
    interesesCesantias: prest.interesesCesantias ? { pago: prest.interesesCesantias.pago } : null,
    cesantiasConsignadas: prest.cesantiasConsignadas ? { pago: prest.cesantiasConsignadas.pago } : null,
    novedades, ibc, salud, pension, fsp, retencion, devengado, deducciones, neto,
    reglas: { desde: r.desde, divisor: r.divisor, smlmv: r.smlmv, uvt: r.uvt },
  };
  return {
    diasBase, diasPagados, activos: diasBase, basico, basicoTrab, recargos: costo.recargos, extrasBase: costo.extrasBase, pagoHoras,
    ausencias, pagoAus, diasNoRem: ausencias.filter((x) => !tipoAusencia(x.tipo).remunerada).reduce((s, x) => s + x.dias, 0),
    diasInc: ausencias.filter((x) => x.origen).reduce((s, x) => s + x.dias, 0),
    descAus, descInc, descuentos, ibc, salud, pension, fsp, diasAux, auxilio,
    novedades: novedadesNetas, novDev, novDed, prima, intereses, cesantiasConsignadas: prest.cesantiasConsignadas?.pago ?? 0, retencion,
    devengado, deducciones, neto, alertas: [...alertas, ...prest.alertas], v2,
  };
}
export type LineaPura = ReturnType<typeof lineaQuincena>;

/** Valida la suma de control de un snapshot v2 (lo usa la acción de aprobar). */
export function validarSnapshotV2(x: SnapshotV2): string | null {
  if (x?.v !== 2) return "sin v2";
  const ints = [x.basico, x.auxilio, x.ibc, x.salud, x.pension, x.fsp, x.retencion, x.devengado, x.deducciones];
  if (ints.some((n) => !Number.isInteger(n) || n < 0)) return "montos no enteros o negativos";
  const dev = x.basico + x.auxilio + x.ausencias.reduce((s, a) => s + a.pago, 0) + Object.values(x.horas).reduce((s, h) => s + (h?.pago ?? 0), 0)
    + (x.prima?.pago ?? 0) + (x.interesesCesantias?.pago ?? 0) + x.novedades.filter((n) => n.naturaleza === "devengado").reduce((s, n) => s + n.valor, 0);
  const ded = x.salud + x.pension + x.fsp + x.retencion + x.novedades.filter((n) => n.naturaleza === "deduccion").reduce((s, n) => s + n.valor, 0);
  if (dev !== x.devengado) return `devengado ${x.devengado} ≠ suma de conceptos ${dev}`;
  if (ded !== x.deducciones) return `deducciones ${x.deducciones} ≠ suma de conceptos ${ded}`;
  if (x.devengado - x.deducciones !== x.neto) return `devengado − deducciones ≠ neto (${x.devengado} − ${x.deducciones} ≠ ${x.neto})`;
  return null;
}
