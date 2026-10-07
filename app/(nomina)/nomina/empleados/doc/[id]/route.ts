import { NextResponse } from "next/server";
import { perspectiva, puedeVerEmpleado } from "@/lib/rrhh/perspectiva";
import { documento, empleado } from "@/lib/rrhh/db";

// Un documento de la ficha (certificación bancaria, consentimiento). Lo abre
// RRHH, el administrador de la tienda o la propia persona; nunca es público.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await perspectiva();
  const d = await documento(Number(id)); if (!d) return new NextResponse("no existe", { status: 404 });
  const e = await empleado(d.empleado_id); if (!e || !puedeVerEmpleado(p, e)) return new NextResponse("no autorizado", { status: 403 });
  return new NextResponse(new Uint8Array(d.bytes), { headers: { "Content-Type": d.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(d.nombre)}"`, "Cache-Control": "private, max-age=300" } });
}
