import type { Metadata } from "next";
import { FormCotizacion } from "./FormCotizacion";

// Landing pública: sin login, sin menú del portal y SIN tocar la base para pintar
// (las áreas son una lista fija en lib/areas.ts). Solo escribe al enviar.
//
// Mismo criterio que /cuentas-de-cobro: el link viaja por WhatsApp, la tarjeta
// de preview es la primera impresión. Imagen generada por `common/og_cards.py`
// (repo datawarehouse), ruta resuelta con el `metadataBase` del layout raíz.
export const metadata: Metadata = {
  title: "Cotización · Oakberry",
  description: "Envía tu cotización a Oakberry (ManelFoods).",
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "Oakberry · ManelFoods",
    url: "/cotizaciones",
    title: "Cotización · Oakberry",
    description: "Envía tu cotización y recibe un código de seguimiento.",
    images: [{ url: "/og/cotizacion.png", width: 1200, height: 630, alt: "Cotización · Oakberry" }],
  },
};

export default function CotizacionesPage() {
  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Cotización</h1>
        <p className="pub-sub">
          Envía tu propuesta a Oakberry (ManelFoods). Te damos un código para que lo pongas en tu factura final.
        </p>
        <FormCotizacion />
        <p className="pub-foot">Oakberry Colombia · ManelFoods S.A.S.</p>
      </div>
    </div>
  );
}
