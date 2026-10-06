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
// que se suma sobre la hora base; la base ya está dentro del básico),
// descuentos, auxilio, novedades y neto. Mismas líneas que la pantalla.
export async function GET(req: NextRequest) {
  let p: Awaited<ReturnType<typeof perspectiva>>;
  try { p = await perspectiva(); } catch { return NextResponse.json({ error: "No autorizado." }, { status: 401 }); }
  if (p.tipo !== "rrhh") return NextResponse.json({ error: "Solo RRHH." }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const q = esFecha(sp.q) ? quincenaDe(sp.q) : ultimaQuincenaCerrada(hoyBogota());
  const tiendaId = sp.t || undefined;
  const N = await cargarNomina(q, { tiendaId });
  const CON_RECARGO = TIPOS.filter((t) => t.id !== "descanso" && t.id !== "ausencia");

  const cab = ["Cédula", "Nombre", "Tienda", "Días", "Horas trabajadas", "Básico",
    ...CON_RECARGO.flatMap((t) => [`${t.label} (h)`, `${t.label} recargo $`]),
    "Total recargos", "Descuento ausencias", "Descuento incapacidad", "IBC", "Salud 4%", "Pensión 4%", "FSP", "Auxilio transporte", "Novedades", "Neto a pagar"];
  const filas: (string | number)[][] = [
    ["Quincena", q.desde, q.hasta, "Origen", "marcación aprobada"],
    cab,
    ...N.lineas.map((x) => [
      "", x.e.nombre_completo, N.nombreTienda(x.e.punto), x.activos, totalTrabajadas(x.l.horas), x.basico,
      ...CON_RECARGO.flatMap((t) => [x.l.horas[t.id], x.l.horas[t.id] ? x.l.costo.porTipo[t.id] - Math.round(x.l.horas[t.id] * x.l.costo.valorHora) : 0]),
      x.recargos, x.descAus, x.descInc, x.ibc, x.salud, x.pension, x.fsp, x.auxilio, x.novedades, x.neto,
    ]),
    ["", "TOTAL", "", "", totalTrabajadas(N.P.horas), N.tot.basico,
      ...CON_RECARGO.flatMap((t) => [N.P.horas[t.id], N.lineas.reduce((a, x) => a + (x.l.horas[t.id] ? x.l.costo.porTipo[t.id] - Math.round(x.l.horas[t.id] * x.l.costo.valorHora) : 0), 0)]),
      N.tot.recargos, N.lineas.reduce((a, x) => a + x.descAus, 0), N.lineas.reduce((a, x) => a + x.descInc, 0), N.tot.ibc, N.tot.salud, N.tot.pension, N.tot.fsp, N.tot.auxilio, N.tot.novedades, N.tot.neto],
  ];
  return respuestaCsv(csv(filas), `novedades_siigo_${q.desde}_${q.hasta}${tiendaId ? "_" + tiendaId.replace(/\W+/g, "") : ""}.csv`);
}
