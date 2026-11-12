import type { Metadata } from "next";
import { FormCuentaCobroRD } from "./FormCuentaCobroRD";
import { empresaRD } from "@/lib/rd/empresa";

// Landing pública de la EMPRESA DE RD: creadores, influencers, alianzas y demás
// proveedores dominicanos que le cobran a Oakberry República Dominicana. Sin
// login y sin tocar la base para pintar (todo el catálogo es una constante en
// lib/rd/catalogo.ts). Solo escribe al enviar.
//
// Llega por un enlace que mandamos por WhatsApp (línea RD): sin openGraph el
// enlace sale como una URL gris y no lo abren. Sin imagen a propósito: la
// tarjeta de Colombia dice ManelFoods, y esto no lo paga ManelFoods.
// Dinámica: los meses elegibles y la razón social (variable de entorno) se leen
// en cada visita, no se congelan el día del build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cuenta de cobro · Oakberry RD",
  description: "Envía tu cuenta de cobro a Oakberry República Dominicana.",
  robots: { index: false, follow: false },
  openGraph: {
    type: "website", locale: "es_DO", siteName: "Oakberry República Dominicana",
    url: "/cuentas-de-cobro/rd",
    title: "Cuenta de cobro · Oakberry RD",
    description: "Envía tus datos y documentos para que procesemos tu pago. Toma 3 minutos.",
  },
};

export default function CuentaDeCobroRDPage() {
  const empresa = empresaRD();
  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Cuenta de cobro · RD</h1>
        <p className="pub-sub">
          Para creadores, influencers y proveedores de <b>Oakberry República Dominicana</b>.
          Envía tus datos y documentos para que procesemos tu pago. Toma 3 minutos.
        </p>
        <FormCuentaCobroRD />
        <p className="pub-foot">
          Tus datos se usan solo para el trámite de pago y el reporte a la DGII. {empresa.nombre}
          {empresa.rnc ? <> · RNC {empresa.rnc}</> : null}
        </p>
      </div>
    </div>
  );
}
