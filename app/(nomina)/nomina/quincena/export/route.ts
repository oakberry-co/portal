import { NextRequest, NextResponse } from "next/server";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { TIPOS, totalTrabajadas } from "@/lib/rrhh/motor";
import { hoyBogota, quincenaDe, esFecha } from "@/lib/rrhh/fechas";
import { csv, respuestaCsv, ultimaQuincenaCerrada } from "../../reportes/_periodo";
import { cargarNomina } from "../_nomina";

export const dynamic = "force-dynamic";

// EXCEL DE NOVEDADES PARA SIIGO NÓMINA (no tiene API: se importa el archivo).
// Una fila por empleado: cédula (vacía: no viaja en el maestro de esta app),
// nombre, básico, por cada tipo de hora sus horas y el RECARGO en pesos (lo
// que se suma sobre la hora base; la base de las ordinarias/recargos ya está
// dentro del básico; la de las EXTRA va en «Extras hora base $»), ausencias,
// retención, auxilio, prestaciones, novedades, devengado, deducciones y neto.
// Mismas líneas que la pantalla. Los nombres de columna los lee
// scripts/backtest_nomina.py: si se cambian, revisar el backtest.
export async function GET(req: NextRequest) {
  let p: Awaited<ReturnType<typeof perspectiva>>;
  try { p = await perspectiva(); } catch { return NextResponse.json({ error: "No autorizado." }, { status: 401 }); }
  if (p.tipo !== "rrhh") return NextResponse.json({ error: "Solo RRHH." }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const q = esFecha(sp.q) ? quincenaDe(sp.q) : ultimaQuincenaCerrada(hoyBogota());
  const tiendaId = sp.t || undefined;
  const N = await cargarNomina(q, { tiendaId });
  const CON_RECARGO = TIPOS.filter((t) => t.id !== "descanso" && t.id !== "ausencia");

  const cab = ["Cédula", "Nombre", "Tienda", "Días", "Días pagados (básico)", "Horas trabajadas", "Básico",
    ...CON_RECARGO.flatMap((t) => [`${t.label} (h)`, `${t.label} recargo $`]),
    "Total recargos", "Extras hora base $", "Pago ausencias", "Descuento ausencias", "Descuento incapacidad", "IBC", "Salud 4%", "Pensión 4%", "FSP", "Retención fuente",
    "Días auxilio", "Auxilio transporte", "Prima", "Intereses cesantías", "Novedades", "Devengado", "Deducciones", "Neto a pagar", "Cesantías al fondo (informativo)"];
  const fila = (x: (typeof N.lineas)[number]) => [
    "", x.e.nombre_completo, N.nombreTienda(x.e.punto), x.diasBase, x.diasPagados, totalTrabajadas(x.l.horas), x.basico,
    ...CON_RECARGO.flatMap((t) => [x.l.horas[t.id], x.l.costo.recargoPorTipo[t.id] ?? 0]),
    x.recargos, x.extrasBase, x.pagoAus, x.descAus, x.descInc, x.ibc, x.salud, x.pension, x.fsp, x.retencion,
    x.diasAux, x.auxilio, x.prima, x.intereses, x.novedades, x.devengado, x.deducciones, x.neto, x.cesantiasConsignadas,
  ];
  const S = (f: (x: (typeof N.lineas)[number]) => number) => N.lineas.reduce((a, x) => a + f(x), 0);
  const filas: (string | number)[][] = [
    ["Quincena", q.desde, q.hasta, "Origen", "marcación aprobada"],
    cab,
    ...N.lineas.map(fila),
    ["", "TOTAL", "", "", "", totalTrabajadas(N.P.horas), N.tot.basico,
      ...CON_RECARGO.flatMap((t) => [N.P.horas[t.id], S((x) => x.l.costo.recargoPorTipo[t.id] ?? 0)]),
      N.tot.recargos, N.tot.extrasBase, S((x) => x.pagoAus), S((x) => x.descAus), S((x) => x.descInc), N.tot.ibc, N.tot.salud, N.tot.pension, N.tot.fsp, N.tot.retencion,
      "", N.tot.auxilio, N.tot.prima, N.tot.intereses, N.tot.novedades, N.tot.devengado, N.tot.deducciones, N.tot.neto, N.tot.cesantiasConsignadas],
  ];
  return respuestaCsv(csv(filas), `novedades_siigo_${q.desde}_${q.hasta}${tiendaId ? "_" + tiendaId.replace(/\W+/g, "") : ""}.csv`);
}
