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

  let datos: unknown = null, generado: Date | null = null;
  try {
    const { rows } = await getPool().query<{ datos: unknown; generado: Date }>(
      "SELECT datos, generado FROM mk_snapshot ORDER BY generado DESC, id DESC LIMIT 1");
    datos = rows[0]?.datos ?? null;
    generado = rows[0]?.generado ?? null;
  } catch (e) {
    console.error("[mercadeo] snapshot", e);
  }
  if (!datos) {
    return <div className="container"><div className="mk"><div className="vacio">Todavía no hay datos de mercadeo. El refresco diario los trae cada mañana.</div></div></div>;
  }
  const sello = generado?.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="container container-wide mk-pagina">
      <p className="mk-sello">Datos al {sello}</p>
      <VistaMercadeo seccion={sec} datos={datos} base={ruta("/mercadeo")} />
    </div>
  );
}
