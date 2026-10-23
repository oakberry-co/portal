import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { signOut } from "@/auth";
import { getPool } from "@/lib/db";
import { CascaraMercadeo } from "./CascaraMercadeo";
import "./mercadeo.css";

// Siempre con sesión: el permiso se evalúa por petición.
export const dynamic = "force-dynamic";

// EL MÓDULO DE MERCADEO — pantalla completa, fuera de la cáscara de contabilidad,
// igual que Nómina: barra lateral con grupos, cabecera con la vista y el cierre de
// sesión. Lo ve todo el equipo @manelfoods.com (capacidad `mercadeo`). Es de solo
// lectura: los datos son el reflejo diario de BigQuery en mk_snapshot.
export default async function MercadeoLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  if (!puede(u.rol, "mercadeo")) redirect("/");

  let sello = "Sin datos todavía", enPausa = false;
  try {
    const { rows } = await getPool().query<{ generado: Date; pausados: number }>(
      `SELECT generado,
              (SELECT count(*) FROM jsonb_array_elements(datos->'envios'->'filas') e WHERE e->>2 = 'pausado')::int AS pausados
         FROM mk_snapshot ORDER BY generado DESC, id DESC LIMIT 1`);
    if (rows[0]) {
      sello = "Datos al " + rows[0].generado.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      enPausa = rows[0].pausados > 0;
    }
  } catch (e) { console.error("[mercadeo] sello", e); }

  const iniciales = u.email.split(/[@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const salir = async () => { "use server"; await signOut({ redirectTo: "/login" }); };
  return (
    <CascaraMercadeo email={u.email} iniciales={iniciales} enPausa={enPausa} sello={sello} salir={salir}>
      {children}
    </CascaraMercadeo>
  );
}
