import { NextRequest, NextResponse } from "next/server";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { totalTrabajadas } from "@/lib/rrhh/motor";
import { hoyBogota } from "@/lib/rrhh/fechas";
import { cargarPeriodo, csv, origenDe, quincenaDeUrl, respuestaCsv } from "../../reportes/_periodo";

export const dynamic = "force-dynamic";

// DESCARGA DE COSTOS: una fila por empleado con el costo empleador abierto en
// sus componentes, más la fila de total. Mismo `periodo()` que la pantalla.
export async function GET(req: NextRequest) {
  let p: Awaited<ReturnType<typeof perspectiva>>;
  try { p = await perspectiva(); } catch { return NextResponse.json({ error: "No autorizado." }, { status: 401 }); }
  if (p.tipo !== "rrhh") return NextResponse.json({ error: "Solo RRHH." }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const q = quincenaDeUrl(sp.q, hoyBogota());
  const tiendaId = sp.t || undefined;
  const origen = origenDe(sp.o);
  const { P, nombreTienda } = await cargarPeriodo(q.desde, q.hasta, { tiendaId }, origen);

  const cab = ["Empleado", "Tienda", "Cargo", "Salario contrato", "Horas trabajadas", "Valor hora", "Salarial", "Recargos", "Auxilio transporte",
    "Salud empleador", "Pensión empleador", "ARL", "Caja", "SENA", "ICBF", "Cesantías", "Int. cesantías", "Prima", "Vacaciones", "Carga prestacional", "Costo total", "Días sin marcación"];
  const filas: (string | number)[][] = [
    ["Quincena", q.desde, q.hasta, "Origen", origen],
    cab,
    ...[...P.lineas].sort((a, b) => b.costo.total - a.costo.total).map((l) => { const c = l.costo; return [
      l.e.nombre_completo, nombreTienda(l.e.punto), l.e.cargo, l.e.salario, totalTrabajadas(l.horas), c.valorHora, c.salarial, c.recargos, c.auxilio,
      c.salud, c.pension, c.arl, c.caja, c.sena, c.icbf, c.cesantias, c.intCesantias, c.prima, c.vacaciones, c.cargaPrestacional, c.total, l.alertas.length,
    ]; }),
    ["TOTAL", "", "", "", totalTrabajadas(P.horas), "", P.tot.salarial, P.tot.recargos, P.tot.auxilio,
      P.tot.salud, P.tot.pension, P.tot.arl, P.tot.caja, P.tot.sena, P.tot.icbf, P.tot.cesantias, P.tot.intCesantias, P.tot.prima, P.tot.vacaciones, P.tot.carga, P.tot.total, P.tot.alertas],
  ];
  return respuestaCsv(csv(filas), `costos_${q.desde}_${q.hasta}${tiendaId ? "_" + tiendaId.replace(/\W+/g, "") : ""}_${origen}.csv`);
}
