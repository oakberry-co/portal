import type { Metadata } from "next";
import { FormCuentaCobro } from "./FormCuentaCobro";
import { getPool } from "@/lib/db";

// La lista de conceptos sale del maestro, no de una constante: es la MISMA que
// usa contabilidad adentro, y de ella cuelga la retención que se practica.
// Texto libre no sirve para eso — "Video UGC" y "2 Videos UGC - OAKBERRY" son
// el mismo concepto y ninguna regla los va a reconocer nunca.
async function conceptos(): Promise<string[]> {
  try {
    const r = await getPool().query<{ nombre: string }>(
      "SELECT nombre FROM maestro_conceptos WHERE activo ORDER BY nombre");
    return r.rows.map((x) => x.nombre);
  } catch {
    return [];   // si la base no responde, el formulario cae a texto libre
  }
}

// Landing pública: sin login, sin menú del portal y SIN tocar la base para pintar
// (las áreas son una lista fija en lib/areas.ts). Solo escribe al enviar.
//
// El proveedor llega SIEMPRE por un link que le mandamos por WhatsApp, así que la
// tarjeta de preview ES la primera impresión del trámite: sin `openGraph` el link
// sale como una URL gris y no lo abren. La imagen la genera
// `common/og_cards.py` (repo datawarehouse); la ruta se resuelve a absoluta con
// el `metadataBase` del layout raíz.
export const metadata: Metadata = {
  title: "Cuenta de cobro · Oakberry",
  description: "Envía tu cuenta de cobro a Oakberry (ManelFoods).",
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "Oakberry · ManelFoods",
    url: "/cuentas-de-cobro",
    title: "Cuenta de cobro · Oakberry",
    description: "Envía tus datos y documentos para que procesemos tu pago. Toma 2 minutos.",
    images: [{ url: "/og/cuenta-de-cobro.png", width: 1200, height: 630, alt: "Cuenta de cobro · Oakberry" }],
  },
};

export default async function CuentaDeCobroPage() {
  const lista = await conceptos();
  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Cuenta de cobro</h1>
        <p className="pub-sub">
          Envía tus datos y documentos para que Oakberry (ManelFoods) procese tu pago. Toma 2 minutos.
        </p>
        <FormCuentaCobro conceptos={lista} />
        <p className="pub-foot">Tus datos se usan solo para el trámite de pago. Oakberry Colombia · ManelFoods S.A.S.</p>
      </div>
    </div>
  );
}
