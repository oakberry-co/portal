import { NextResponse } from "next/server";
import { getCurrentUserOrNull } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { estadoIntake } from "@/lib/intake";

export const dynamic = "force-dynamic";

/** Sentinela del intake (Regla 14: todo bug corregido deja su check).
 *
 *  Los dos portales públicos dependen de un relay en la VM + 2 variables en
 *  Vercel. Cuando faltan, el proveedor recibe un error y NADIE se entera. Este
 *  endpoint responde si el carril está completo, SIN revelar el secreto:
 *
 *    GET /api/salud/intake  ->  { ok, url_configurada, secreto_configurado, relay }
 *
 *  `relay` hace un ping real (sin archivo) para distinguir "mal configurado"
 *  de "la VM está caída". */
export async function GET() {
  const user = await getCurrentUserOrNull();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!puede(user.rol, "intake")) {
    return NextResponse.json({ error: "No autorizado (intake)." }, { status: 403 });
  }

  const estado = await estadoIntake();
  return NextResponse.json(estado, { status: estado.ok ? 200 : 503 });
}
