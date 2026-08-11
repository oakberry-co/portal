import type { Metadata } from "next";
import { getPool } from "@/lib/db";
import { FormCotizacion } from "./FormCotizacion";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cotización · Oakberry",
  description: "Envía tu cotización a Oakberry (ManelFoods).",
};

async function cargarAreas(): Promise<string[]> {
  try {
    const r = await getPool().query<{ nombre: string }>(
      "SELECT nombre FROM maestro_destinos WHERE activo ORDER BY nombre");
    return r.rows.map((x) => x.nombre);
  } catch {
    return [];
  }
}

export default async function CotizacionesPage() {
  const areas = await cargarAreas();
  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Cotización</h1>
        <p className="pub-sub">
          Envía tu propuesta a Oakberry (ManelFoods). Te damos un código para que lo pongas en tu factura final.
        </p>
        <FormCotizacion areas={areas} />
        <p className="pub-foot">Oakberry Colombia · ManelFoods S.A.S.</p>
      </div>
    </div>
  );
}
