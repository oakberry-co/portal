// AGREGADOS POR PERÍODO — Reportes, Costos, Financiero, Nómina y Cumplimiento
// pasan por acá, y acá todo pasa por el MISMO motor (horasDe / costoDe).
//
// Dos orígenes:
//   plan  = los turnos (lo que el administrador de punto planeó)
//   real  = SOLO las marcaciones APROBADAS (las normales se aprueban solas al
//           marcar; las inusuales esperan al administrador), emparejadas por día;
//           descansos y ausencias aprobadas se toman del plan; un turno
//           programado sin marcación vale 0 h y deja una alerta.
import { costoDe, deduccionesDe, horasDe, horasVacias, sumar, totalTrabajadas, type Costo, type Horas, type Turno } from "./motor";
import type { EmpleadoDb, Marcacion, TurnoDb } from "./db";
import { rango } from "./fechas";

export type Origen = "plan" | "real";
export type DiaEmp = { fecha: string; turno: TurnoDb | null; real: Turno | null; alerta: string | null };
export type LineaEmp = { e: EmpleadoDb; dias: DiaEmp[]; turnos: Turno[]; horas: Horas; costo: Costo; ded: ReturnType<typeof deduccionesDe>; nTurnos: number; alertas: string[] };

/** Empareja marcaciones de un día en un intervalo trabajado. Toma la primera
 *  entrada y la última salida (si alguien marcó dos veces, cuenta una). */
export function intervaloReal(ms: Marcacion[], t: TurnoDb | null, e: EmpleadoDb, fecha: string, almuerzoMin: number): Turno | null {
  const ok = ms.filter((m) => m.estado === "aprobada");
  const ent = ok.filter((m) => m.tipo === "entrada").sort((a, b) => a.hora - b.hora)[0];
  const sal = ok.filter((m) => m.tipo === "salida").sort((a, b) => b.hora - a.hora)[0];
  if (!ent || !sal) return null;
  const inicio = Math.round(ent.hora * 4) / 4, fin = Math.round(sal.hora * 4) / 4;   // al cuarto de hora
  if (fin <= inicio) return null;
  return { id: `r-${e.activo_id}-${fecha}`, empleadoId: e.activo_id, tiendaId: ent.tienda_id, fecha, inicio, fin, tipo: "programado", almuerzoMin, estado: "aprobado" };
}

export function periodo(EMPLEADOS: EmpleadoDb[], turnosDb: TurnoDb[], marcs: Marcacion[], desde: string, hasta: string, origen: Origen, almuerzoPorTienda: Record<string, number> = {}) {
  const fechas = rango(desde, hasta);
  const lineas: LineaEmp[] = EMPLEADOS.map((e) => {
    const alertas: string[] = [];
    const dias: DiaEmp[] = fechas.map((fecha) => {
      if (fecha < e.fecha_ingreso || (e.fecha_retiro && fecha > e.fecha_retiro)) return { fecha, turno: null, real: null, alerta: null };
      const turno = turnosDb.find((t) => t.empleadoId === e.activo_id && t.fecha === fecha) ?? null;
      const ms = marcs.filter((m) => m.empleado_id === e.activo_id && m.fecha === fecha);
      const real = intervaloReal(ms, turno, e, fecha, turno?.almuerzoMin ?? almuerzoPorTienda[e.punto] ?? 0);
      let alerta: string | null = null;
      if (origen === "real" && turno?.tipo === "programado" && !real) alerta = "sin marcación";
      if (!turno && real) alerta = "marcó sin turno";
      return { fecha, turno, real, alerta };
    });
    const turnos: Turno[] = [];
    for (const dd of dias) {
      if (origen === "plan") { if (dd.turno) turnos.push(dd.turno); continue; }
      if (dd.real) turnos.push(dd.real);
      else if (dd.turno && dd.turno.tipo !== "programado") turnos.push(dd.turno);
      if (dd.alerta) alertas.push(`${dd.fecha}: ${dd.alerta}`);
    }
    const costo = costoDe(e, turnos, hasta);
    return { e, dias, turnos, horas: costo.horas, costo, ded: deduccionesDe(e, costo, hasta), nTurnos: turnos.filter((t) => t.tipo === "programado").length, alertas };
  });
  const horas = lineas.reduce((a, l) => sumar(a, l.horas), horasVacias());
  const sum = (f: (l: LineaEmp) => number) => lineas.reduce((a, l) => a + f(l), 0);
  const tot = {
    salarial: sum((l) => l.costo.salarial), recargos: sum((l) => l.costo.recargos), auxilio: sum((l) => l.costo.auxilio),
    salud: sum((l) => l.costo.salud), pension: sum((l) => l.costo.pension), arl: sum((l) => l.costo.arl), caja: sum((l) => l.costo.caja), sena: sum((l) => l.costo.sena), icbf: sum((l) => l.costo.icbf),
    cesantias: sum((l) => l.costo.cesantias), intCesantias: sum((l) => l.costo.intCesantias), prima: sum((l) => l.costo.prima), vacaciones: sum((l) => l.costo.vacaciones),
    carga: sum((l) => l.costo.cargaPrestacional), total: sum((l) => l.costo.total),
    neto: sum((l) => l.ded.neto), deducciones: sum((l) => l.ded.total), nTurnos: sum((l) => l.nTurnos), alertas: sum((l) => l.alertas.length),
  };
  const porTienda = Object.fromEntries([...new Set(lineas.map((l) => l.e.punto))].map((p) => {
    const ls = lineas.filter((l) => l.e.punto === p);
    return [p, { total: ls.reduce((a, l) => a + l.costo.total, 0), horas: ls.reduce((a, l) => sumar(a, l.horas), horasVacias()), n: ls.length, nTurnos: ls.reduce((a, l) => a + l.nTurnos, 0), alertas: ls.reduce((a, l) => a + l.alertas.length, 0) }];
  })) as Record<string, { total: number; horas: Horas; n: number; nTurnos: number; alertas: number }>;
  return { fechas, lineas, horas, tot, porTienda, trabajadas: totalTrabajadas(horas) };
}
export { horasDe, totalTrabajadas };
