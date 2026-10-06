import { NextResponse } from "next/server";
import { perspectiva, puedeRevisar } from "@/lib/rrhh/perspectiva";
import { selfie } from "@/lib/rrhh/db";
import { getPool } from "@/lib/db";

// La selfie de una marcación. Solo la ve quien puede revisar esa tienda o la
// propia persona; nunca es pública.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await perspectiva();
  const { rows } = await getPool().query("SELECT empleado_id, tienda_id FROM rrhh_marcaciones WHERE id = $1", [Number(id)]);
  const m = rows[0]; if (!m) return new NextResponse("no existe", { status: 404 });
  const propia = p.tipo !== "rrhh" && p.empleado.activo_id === m.empleado_id;
  if (!propia && !puedeRevisar(p, m.tienda_id)) return new NextResponse("no autorizado", { status: 403 });
  const img = await selfie(Number(id)); if (!img) return new NextResponse("sin foto", { status: 404 });
  return new NextResponse(new Uint8Array(img), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } });
}
