// LÍNEAS DE LA NÓMINA QUINCENAL — las usa la pantalla y el export de Siigo.
//
// Básico = salario del contrato ÷ 2 (NO horas × tarifa). Las horas MARCADAS y
// aprobadas solo suman recargos. Descuentos: ausencias no remuneradas (día
// hábil × salario/30) e incapacidad (día × salario/30 × 33,33 % que no paga el
// empleador). IBC = básico + recargos − descuentos, sin auxilio. Salud 4 %,
// pensión 4 %, FSP 1 % desde 4 SMLMV. Las novedades (+/−) entran al neto.
import { novedades as qNovedades, solicitudes as qSolicitudes, type Novedad, type Solicitud } from "@/lib/rrhh/db";
import { reglasEn, FESTIVOS } from "@/lib/rrhh/motor";
import { diasHabiles, rango } from "@/lib/rrhh/fechas";
import { TIPOS_AUSENCIA } from "@/lib/rrhh/catalogos";
import { cargarPeriodo, type Filtro } from "../reportes/_periodo";

const NO_REMUNERADAS = new Set(TIPOS_AUSENCIA.filter((t) => !t.remunerada).map((t) => t.tipo as string));
const PCT_INCAPACIDAD = TIPOS_AUSENCIA.find((t) => t.tipo === "Incapacidad")?.pct ?? 66.67;

export async function cargarNomina(q: { desde: string; hasta: string }, f: Filtro) {
  const per = await cargarPeriodo(q.desde, q.hasta, f, "real");
  const [sols, novs] = await Promise.all([
    qSolicitudes({ estado: "aprobado", desde: q.desde, hasta: q.hasta, tiendaId: f.tiendaId }),
    qNovedades(q.desde),
  ]);
  const r = reglasEn(q.hasta);
  const diasQ = rango(q.desde, q.hasta).length;
  const lineas = per.P.lineas.map((l) => {
    const e = l.e;
    // Prorrateo del básico si entró o se fue dentro de la quincena.
    const activos = rango(q.desde, q.hasta).filter((d) => d >= e.fecha_ingreso && (!e.fecha_retiro || d <= e.fecha_retiro)).length;
    const basico = Math.round(e.salario / 2 * activos / diasQ);
    const recargos = l.costo.recargos;
    const diaSalario = e.salario / 30;
    const mias = sols.filter((s) => s.empleado_id === e.activo_id);
    const recorte = (s: Solicitud) => ({ desde: s.desde < q.desde ? q.desde : s.desde, hasta: s.hasta > q.hasta ? q.hasta : s.hasta });
    const diasNoRem = mias.filter((s) => NO_REMUNERADAS.has(s.tipo)).reduce((a, s) => { const x = recorte(s); return a + diasHabiles(x.desde, x.hasta, FESTIVOS); }, 0);
    const diasInc = mias.filter((s) => s.tipo === "Incapacidad").reduce((a, s) => { const x = recorte(s); return a + rango(x.desde, x.hasta).length; }, 0);
    const descAus = Math.round(diasNoRem * diaSalario);
    const descInc = Math.round(diasInc * diaSalario * (100 - PCT_INCAPACIDAD) / 100);
    const descuentos = descAus + descInc;
    const ibc = Math.max(0, basico + recargos - descuentos);
    const salud = Math.round(ibc * 0.04), pension = Math.round(ibc * 0.04);
    const fsp = e.salario >= 4 * r.smlmv ? Math.round(ibc * 0.01) : 0;
    const auxilio = l.costo.auxilio;
    const misNov = novs.filter((n) => n.empleado_id === e.activo_id);
    const novedades = misNov.reduce((a, n) => a + n.valor, 0);
    const neto = ibc + auxilio - salud - pension - fsp + novedades;
    return { l, e, basico, activos, recargos, diasNoRem, diasInc, descAus, descInc, descuentos, ibc, salud, pension, fsp, auxilio, novedades, misNov, neto };
  }).sort((a, b) => b.neto - a.neto);
  const S = (f: (x: Linea) => number) => lineas.reduce((a, x) => a + f(x), 0);
  const tot = {
    basico: S((x) => x.basico), recargos: S((x) => x.recargos), descuentos: S((x) => x.descuentos), ibc: S((x) => x.ibc),
    salud: S((x) => x.salud), pension: S((x) => x.pension), fsp: S((x) => x.fsp), auxilio: S((x) => x.auxilio), novedades: S((x) => x.novedades), neto: S((x) => x.neto),
    devengado: S((x) => x.ibc + x.auxilio), deducciones: S((x) => x.salud + x.pension + x.fsp),
    costoEmpleador: S((x) => x.ibc + x.auxilio) + per.P.tot.carga,
  };
  return { ...per, lineas, tot, novs, sols, r };
}
export type Linea = {
  l: Awaited<ReturnType<typeof cargarPeriodo>>["P"]["lineas"][number]; e: Awaited<ReturnType<typeof cargarPeriodo>>["E"][number];
  basico: number; activos: number; recargos: number; diasNoRem: number; diasInc: number; descAus: number; descInc: number; descuentos: number;
  ibc: number; salud: number; pension: number; fsp: number; auxilio: number; novedades: number; misNov: Novedad[]; neto: number;
};
export type Nomina = Awaited<ReturnType<typeof cargarNomina>>;

/** Lo que se guarda al aprobar: la foto de cada línea, sin objetos pesados. */
export const snapshotDe = (lineas: Linea[]) => lineas.map((x) => ({
  empleadoId: x.e.activo_id, nombre: x.e.nombre_completo, basico: x.basico, recargos: x.recargos, descuentos: x.descuentos, ibc: x.ibc,
  salud: x.salud, pension: x.pension, fsp: x.fsp, auxilio: x.auxilio, novedades: x.novedades, neto: x.neto,
}));
