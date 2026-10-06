import { NextRequest, NextResponse } from "next/server";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { TIPOS, totalTrabajadas } from "@/lib/rrhh/motor";
import { hoyBogota } from "@/lib/rrhh/fechas";
import { cargarPeriodo, csv, origenDe, rangoDeUrl, respuestaCsv } from "../_periodo";

export const dynamic = "force-dynamic";

// EXCEL DE REPORTES: horas por empleado y tipo, con los MISMOS filtros y el
// MISMO `periodo()` que la pantalla. Sale en CSV con BOM: Excel lo abre con
// tildes y columnas bien sin asistente de importación.
export async function GET(req: NextRequest) {
  let p: Awaited<ReturnType<typeof perspectiva>>;
  try { p = await perspectiva(); } catch { return NextResponse.json({ error: "No autorizado." }, { status: 401 }); }
  if (p.tipo === "colaborador") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const tiendaId = p.tipo === "admin_punto" ? p.tiendaId : sp.t || undefined;
  const empleadoId = sp.e && /^\d+$/.test(sp.e) ? Number(sp.e) : undefined;
  const origen = origenDe(sp.o);
  const { desde, hasta } = rangoDeUrl(sp, hoyBogota());
  const { P, nombreTienda } = await cargarPeriodo(desde, hasta, { tiendaId, empleadoId }, origen);

  const filas: (string | number)[][] = [
    ["Empleado", "Tienda", "Cargo", "Origen", "Desde", "Hasta", ...TIPOS.map((t) => t.label), "Total trabajadas", "Turnos", "Días sin marcación", "Detalle alertas"],
    ...[...P.lineas].sort((a, b) => totalTrabajadas(b.horas) - totalTrabajadas(a.horas)).map((l) => [
      l.e.nombre_completo, nombreTienda(l.e.punto), l.e.cargo, origen, desde, hasta,
      ...TIPOS.map((t) => l.horas[t.id]), totalTrabajadas(l.horas), l.nTurnos, l.alertas.length, l.alertas.join(" | "),
    ]),
    ["TOTAL", "", "", origen, desde, hasta, ...TIPOS.map((t) => P.horas[t.id]), totalTrabajadas(P.horas), P.tot.nTurnos, P.tot.alertas, ""],
  ];
  return respuestaCsv(csv(filas), `horas_${desde}_${hasta}${tiendaId ? "_" + tiendaId.replace(/\W+/g, "") : ""}_${origen}.csv`);
}
