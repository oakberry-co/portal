import { NextRequest, NextResponse } from "next/server";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { reglasNomina } from "@/lib/rrhh/motor";
import { aportesPila } from "@/lib/rrhh/pila";
import { hoyBogota, mas } from "@/lib/rrhh/fechas";
import { csv, respuestaCsv } from "../../reportes/_periodo";
import { cargarMes } from "../_nomina";

export const dynamic = "force-dynamic";

// APORTES PILA DEL MES — CSV DE REVISIÓN (no es la planilla del operador).
// Una fila por cotizante con IBC, días y cada aporte (trabajador/empleador),
// calculados con lib/rrhh/pila.ts sobre las DOS quincenas del mes (mismo
// motor que la pantalla de Nómina). Sirve para cuadrar contra la planilla que
// liquida Siigo/el operador. El archivo plano de la Res. 2388/2016 está
// pendiente (ver TODO en lib/rrhh/pila.ts).
export async function GET(req: NextRequest) {
  let p: Awaited<ReturnType<typeof perspectiva>>;
  try { p = await perspectiva(); } catch { return NextResponse.json({ error: "No autorizado." }, { status: 401 }); }
  if (p.tipo !== "rrhh") return NextResponse.json({ error: "Solo RRHH." }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const mes = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m : mas(hoyBogota().slice(0, 8) + "01", -1).slice(0, 7);
  const tiendaId = sp.t || undefined;
  const { q2, N1, N2 } = await cargarMes(mes, { tiendaId });
  const r = reglasNomina(q2.hasta);
  const porEmp = new Map<number, { e: (typeof N1.lineas)[number]["e"]; ibc: number; dias: number; ded: number }>();
  for (const x of [...N1.lineas, ...N2.lineas]) {
    const a = porEmp.get(x.e.activo_id) ?? { e: x.e, ibc: 0, dias: 0, ded: 0 };
    a.ibc += x.ibc; a.dias += x.diasBase; a.ded += x.salud + x.pension + x.fsp;
    porEmp.set(x.e.activo_id, a);
  }
  const filas = [...porEmp.values()].map((a) => ({
    a, p: aportesPila({ empleadoId: a.e.activo_id, nombre: a.e.nombre_completo, salario: a.e.salario, devengadoSalarial: a.ibc, dias: a.dias, arlClase: a.e.arl_clase, smlmv: r.smlmv }),
  }));
  const cab = ["Cédula", "Nombre", "Tienda", "Días", "Devengado salarial", "IBC", "Exonerado 1607", "Clase ARL",
    "Salud trabajador", "Salud empleador", "Pensión trabajador", "Pensión empleador", "FSP", "ARL", "CCF", "SENA", "ICBF",
    "Total trabajador", "Total empleador", "Total", "Deducido en nómina (salud+pensión+FSP)", "Diferencia trabajador"];
  const out: (string | number)[][] = [["PILA (revisión)", mes, "Res. 2388/2016: archivo plano PENDIENTE"], cab,
    ...filas.map(({ a, p: x }) => ["", a.e.nombre_completo, N2.nombreTienda(a.e.punto), x.dias, a.ibc, x.ibc, x.exonerado ? "sí" : "no", x.arlClase,
      x.saludTrab, x.saludEmp, x.pensionTrab, x.pensionEmp, x.fsp, x.arl, x.ccf, x.sena, x.icbf, x.totalTrabajador, x.totalEmpleador, x.total, a.ded, x.totalTrabajador - a.ded])];
  return respuestaCsv(csv(out), `pila_revision_${mes}${tiendaId ? "_" + tiendaId.replace(/\W+/g, "") : ""}.csv`);
}
