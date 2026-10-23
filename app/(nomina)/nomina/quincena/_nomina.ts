// LÍNEAS DE LA NÓMINA QUINCENAL — las usan la pantalla, el export de Siigo,
// la PILA y el snapshot que se guarda al aprobar.
//
// Aquí solo va la LECTURA (base de datos) y el armado del mes; el cálculo de
// cada línea es la función pura `lineaQuincena` (lib/rrhh/quincena.ts, con
// tests en scripts/test_nomina_motor.js). Horas y recargos (con EXTRAS por
// semana) salen del mismo motor que Costos y Cumplimiento (cargarPeriodo →
// periodo → costoDe).
//
// Retención en la fuente: mensual (lib/rrhh/retencion.ts). Se practica en la
// 2ª quincena sobre lo devengado en el MES: la 1ª quincena se toma de su
// snapshot APROBADO si existe (lo que de verdad se pagó); si no, se recalcula
// con el mismo motor y la línea lo avisa.
import { novedades as qNovedades, solicitudes as qSolicitudes, snapshotAprobado, type Novedad, type Solicitud } from "@/lib/rrhh/db";
import { reglasNomina, reglasEn, uvtDe, totalTrabajadas, FESTIVOS } from "@/lib/rrhh/motor";
import { mesDe } from "@/lib/rrhh/fechas";
import { lineaQuincena, type LineaPura } from "@/lib/rrhh/quincena";
import { prestacionesDeQuincena } from "@/lib/rrhh/prestaciones";
import { retencionMensual } from "@/lib/rrhh/retencion";
import { cargarPeriodo, type Filtro } from "../reportes/_periodo";

type Q = { desde: string; hasta: string };
const primeraQuincena = (q: Q): Q => ({ desde: q.desde.slice(0, 8) + "01", hasta: q.desde.slice(0, 8) + "15" });
const esSegunda = (q: Q) => q.desde.endsWith("-16");

/** Lo que entra a la retención por persona: pagos laborales y aportes obligatorios. */
type BaseMes = { pagos: number; aportes: number; retencion: number; fuente: "snapshot v2" | "snapshot v1" | "recalculada" };

async function lineasSinRetencion(q: Q, f: Filtro) {
  const per = await cargarPeriodo(q.desde, q.hasta, f, "real");
  const [sols, novs] = await Promise.all([
    qSolicitudes({ estado: "aprobado", desde: q.desde, hasta: q.hasta, tiendaId: f.tiendaId }),
    qNovedades(q.desde),
  ]);
  const r = reglasNomina(q.hasta);
  const rAnterior = reglasEn(`${Number(q.desde.slice(0, 4)) - 1}-12-31`);
  const armar = (l: (typeof per.P.lineas)[number], retencion: number) => lineaQuincena({
    e: l.e, q,
    costo: { horas: l.costo.horas, recargos: l.costo.recargos, extrasBase: l.costo.extrasBase, basePorTipo: l.costo.basePorTipo, recargoPorTipo: l.costo.recargoPorTipo, trabajadas: totalTrabajadas(l.costo.horas) },
    sols: sols.filter((s) => s.empleado_id === l.e.activo_id),
    novs: novs.filter((n) => n.empleado_id === l.e.activo_id),
    r, prest: prestacionesDeQuincena(l.e, q, r, rAnterior), retencion, festivos: FESTIVOS,
  });
  const lineas = per.P.lineas.map((l) => ({ l, e: l.e, misNov: novs.filter((n) => n.empleado_id === l.e.activo_id), ...armar(l, 0) }));
  return { per, sols, novs, r, lineas, armar };
}

/** Pagos y aportes de la 1ª quincena por persona (para la retención del mes). */
async function baseDePrimera(q: Q, f: Filtro): Promise<Map<number, BaseMes>> {
  const q1 = primeraQuincena(q);
  const snap = await snapshotAprobado(q1.desde);
  const out = new Map<number, BaseMes>();
  if (snap) {
    for (const x of snap as Record<string, any>[]) {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const id = Number(x.empleadoId);
      if (x.v2?.v === 2) out.set(id, { pagos: x.v2.devengado, aportes: x.v2.salud + x.v2.pension + x.v2.fsp, retencion: x.v2.retencion, fuente: "snapshot v2" });
      else {
        // v1 no separa novedades a favor y en contra: se toman las positivas netas. Aproximado → avisa.
        const n = Number(x.novedades) || 0;
        out.set(id, { pagos: Number(x.ibc) + Number(x.auxilio) + Math.max(0, n), aportes: Number(x.salud) + Number(x.pension) + Number(x.fsp), retencion: 0, fuente: "snapshot v1" });
      }
    }
    return out;
  }
  const { lineas } = await lineasSinRetencion(q1, f);
  for (const x of lineas) out.set(x.e.activo_id, { pagos: x.devengado, aportes: x.salud + x.pension + x.fsp, retencion: x.retencion, fuente: "recalculada" });
  return out;
}

type LineaPeriodo = Awaited<ReturnType<typeof cargarPeriodo>>["P"]["lineas"][number];
export type Linea = LineaPura & { l: LineaPeriodo; e: LineaPeriodo["e"]; misNov: Novedad[]; baseRetencion: BaseMes | null };

export async function cargarNomina(q: Q, f: Filtro) {
  const base = await lineasSinRetencion(q, f);
  const { per, novs, sols, r } = base;
  let lineas: Linea[] = base.lineas.map((x) => ({ ...x, baseRetencion: null }));
  if (esSegunda(q)) {
    const uvt = uvtDe(q.hasta);
    const prev = await baseDePrimera(q, f);
    lineas = lineas.map((x) => {
      const p = prev.get(x.e.activo_id);
      const pagos = x.devengado + (p?.pagos ?? 0), aportes = x.salud + x.pension + x.fsp + (p?.aportes ?? 0);
      const ret = retencionMensual({ pagosLaborales: pagos, aportesObligatorios: aportes, uvt });
      const retencion = Math.max(0, ret.retencion - (p?.retencion ?? 0));
      if (retencion === 0) return { ...x, baseRetencion: p ?? null };
      const y = { ...x, ...base.armar(x.l, retencion), baseRetencion: p ?? null };
      if (p && p.fuente !== "snapshot v2") y.alertas = [...y.alertas, `Retención con la 1ª quincena ${p.fuente === "recalculada" ? "sin aprobar (recalculada)" : "aprobada en formato v1 (aproximada)"}`];
      return y;
    });
  }
  lineas.sort((a, b) => b.neto - a.neto);
  const S = (fn: (x: Linea) => number) => lineas.reduce((a, x) => a + fn(x), 0);
  const tot = {
    basico: S((x) => x.basico), recargos: S((x) => x.recargos), extrasBase: S((x) => x.extrasBase), descuentos: S((x) => x.descuentos), ibc: S((x) => x.ibc),
    salud: S((x) => x.salud), pension: S((x) => x.pension), fsp: S((x) => x.fsp), retencion: S((x) => x.retencion), auxilio: S((x) => x.auxilio), novedades: S((x) => x.novedades),
    prima: S((x) => x.prima), intereses: S((x) => x.intereses), cesantiasConsignadas: S((x) => x.cesantiasConsignadas), neto: S((x) => x.neto),
    devengado: S((x) => x.devengado), deducciones: S((x) => x.deducciones),
    costoEmpleador: S((x) => x.ibc + x.auxilio) + per.P.tot.carga,
  };
  if (tot.devengado - tot.deducciones !== tot.neto) throw new Error(`Nómina ${q.desde}: suma de control de totales rota.`);
  return { ...per, lineas, tot, novs, sols, r };
}
export type Nomina = Awaited<ReturnType<typeof cargarNomina>>;
export type { Solicitud };

/** Lo que se guarda al aprobar: la foto de cada línea (campos v1, intactos) +
 *  `v2` con el contrato para la nómina electrónica (lib/rrhh/SNAPSHOT_V2.md). */
export const snapshotDe = (lineas: Linea[]) => lineas.map((x) => ({
  empleadoId: x.e.activo_id, nombre: x.e.nombre_completo, basico: x.basico, recargos: x.recargos, descuentos: x.descuentos, ibc: x.ibc,
  salud: x.salud, pension: x.pension, fsp: x.fsp, auxilio: x.auxilio, novedades: x.novedades, neto: x.neto,
  v2: x.v2,
}));

/** Las dos quincenas de un mes, por persona, para la PILA. */
export async function cargarMes(mes: string, f: Filtro) {
  const q1 = { desde: `${mes}-01`, hasta: `${mes}-15` };
  const q2 = { desde: `${mes}-16`, hasta: mesDe(`${mes}-01`).hasta };
  const [N1, N2] = await Promise.all([cargarNomina(q1, f), cargarNomina(q2, f)]);
  return { q1, q2, N1, N2 };
}
