import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { ruta } from "@/lib/ruta";
import { VistaMercadeo } from "../VistaMercadeo";
import { SECCIONES } from "../secciones";

export const dynamic = "force-dynamic";

// Una sola página para todas las secciones (/mercadeo, /mercadeo/cohortes, …): lee la
// foto más nueva de mk_snapshot y la vista pinta la sección pedida. La foto la
// escribe cada mañana datawarehouse/dashboards/mercadeo/export_mercadeo.py --pg.
export default async function MercadeoPage({ params }: { params: Promise<{ seccion?: string[] }> }) {
  const { seccion } = await params;
  const sec = seccion?.[0] ?? "inicio";
  if (!SECCIONES.includes(sec) || (seccion?.length ?? 0) > 1) notFound();

  let datos: unknown = null;
  try {
    const { rows } = await getPool().query<{ datos: unknown }>(
      "SELECT datos FROM mk_snapshot ORDER BY generado DESC, id DESC LIMIT 1");
    datos = rows[0]?.datos ?? null;
  } catch (e) {
    console.error("[mercadeo] snapshot", e);
  }
  if (!datos) {
    return <div className="vacio">Todavía no hay datos de mercadeo. El refresco diario los trae cada mañana.</div>;
  }
  return <VistaMercadeo seccion={sec} datos={datos} base={ruta("/mercadeo")} />;
}
