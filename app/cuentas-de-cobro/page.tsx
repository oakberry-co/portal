import type { Metadata } from "next";
import { getPool } from "@/lib/db";
import { FormCuentaCobro } from "./FormCuentaCobro";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cuenta de cobro · Oakberry",
  description: "Envía tu cuenta de cobro a Oakberry (ManelFoods).",
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

export default async function CuentaDeCobroPage() {
  const areas = await cargarAreas();
  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Cuenta de cobro</h1>
        <p className="pub-sub">
          Envía tus datos y documentos para que Oakberry (ManelFoods) procese tu pago. Toma 2 minutos.
        </p>
        <FormCuentaCobro areas={areas} />
        <p className="pub-foot">Tus datos se usan solo para el trámite de pago. Oakberry Colombia · ManelFoods S.A.S.</p>
      </div>
    </div>
  );
}
