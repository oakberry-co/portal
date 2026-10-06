// Agregados por período que comparten Reportes, Costos, Financiero y Nómina.
// Todos pasan por el MISMO motor (horasDe / costoDe): si cambia una regla,
// cambian todas las pantallas a la vez.
import { turnosEntre, tienda } from "./datos";
import { costoDe, deduccionesDe, horasDe, horasVacias, sumar, type Costo, type Horas, type Empleado } from "./motor";

export type LineaEmp = { e: Empleado; horas: Horas; costo: Costo; ded: ReturnType<typeof deduccionesDe>; nTurnos: number };

export function periodo(EMPLEADOS: Empleado[], desde: string, hasta: string) {
  const turnos = turnosEntre(EMPLEADOS, desde, hasta).filter((t) => tienda(t.tiendaId)?.activa);
  const lineas: LineaEmp[] = EMPLEADOS.filter((e) => tienda(e.punto)?.activa).map((e) => {
    const mios = turnos.filter((t) => t.empleadoId === e.activo_id);
    const costo = costoDe(e, mios, hasta);
    return { e, horas: costo.horas, costo, ded: deduccionesDe(e, costo, hasta), nTurnos: mios.filter((t) => t.tipo === "programado").length };
  });
  const horas = lineas.reduce((a, l) => sumar(a, l.horas), horasVacias());
  const sum = (f: (l: LineaEmp) => number) => lineas.reduce((a, l) => a + f(l), 0);
  const tot = {
    salarial: sum((l) => l.costo.salarial), recargos: sum((l) => l.costo.recargos), auxilio: sum((l) => l.costo.auxilio),
    salud: sum((l) => l.costo.salud), pension: sum((l) => l.costo.pension), arl: sum((l) => l.costo.arl), caja: sum((l) => l.costo.caja), sena: sum((l) => l.costo.sena), icbf: sum((l) => l.costo.icbf),
    cesantias: sum((l) => l.costo.cesantias), intCesantias: sum((l) => l.costo.intCesantias), prima: sum((l) => l.costo.prima), vacaciones: sum((l) => l.costo.vacaciones),
    carga: sum((l) => l.costo.cargaPrestacional), total: sum((l) => l.costo.total),
    neto: sum((l) => l.ded.neto), deducciones: sum((l) => l.ded.total), nTurnos: sum((l) => l.nTurnos),
  };
  const porTienda = Object.fromEntries(
    [...new Set(lineas.map((l) => l.e.punto))].map((p) => {
      const ls = lineas.filter((l) => l.e.punto === p);
      return [p, { total: ls.reduce((a, l) => a + l.costo.total, 0), horas: ls.reduce((a, l) => sumar(a, l.horas), horasVacias()), n: ls.length, nTurnos: ls.reduce((a, l) => a + l.nTurnos, 0) }];
    }),
  ) as Record<string, { total: number; horas: Horas; n: number; nTurnos: number }>;
  return { turnos, lineas, horas, tot, porTienda };
}
export { horasDe };
