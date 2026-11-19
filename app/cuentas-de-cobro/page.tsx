import type { Metadata } from "next";
import { FormCuentaCobro } from "./FormCuentaCobro";
import { FormCuentaCobroRD } from "./rd/FormCuentaCobroRD";
import { getPool } from "@/lib/db";
import { empresaRD, rncLegible } from "@/lib/rd/empresa";
import { SelectorPais, paisDe } from "../SelectorPais";

// UNA SOLA PÁGINA para Colombia y República Dominicana (19-nov-2026), con el
// selector de país arriba. Colombia es el default: los enlaces que ya circulan
// (/cuentas-de-cobro, sin país) siguen abriendo el formulario de siempre. RD
// llega con ?pais=rd — y /cuentas-de-cobro/rd redirige acá.
//
// Cada país conserva SU formulario y SU tabla: el de RD pide cédula/RNC, NCF,
// DOP/USD y escribe en rd_cuentas_cobro; el de Colombia, NIT, conceptos del
// maestro y cuentas_cobro. Compartir la página no junta la plata.
//
// Dinámica: el país sale de la URL, y en RD los meses elegibles y la razón
// social (variable de entorno) se leen en cada visita.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ pais?: string }> };

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

// El proveedor llega SIEMPRE por un link que le mandamos por WhatsApp, así que la
// tarjeta de preview ES la primera impresión del trámite: sin `openGraph` el link
// sale como una URL gris y no lo abren. La imagen de Colombia la genera
// `common/og_cards.py` (repo datawarehouse); la ruta se resuelve a absoluta con
// el `metadataBase` del layout raíz.
const META_CO: Metadata = {
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

// RD sin imagen a propósito: la tarjeta de Colombia dice ManelFoods, y esto no
// lo paga ManelFoods. Fuera de los buscadores: solo se llega por enlace.
const META_RD: Metadata = {
  title: "Cuenta de cobro · Oakberry RD",
  description: "Envía tu cuenta de cobro a Oakberry República Dominicana.",
  robots: { index: false, follow: false },
  openGraph: {
    type: "website", locale: "es_DO", siteName: "Oakberry República Dominicana",
    url: "/cuentas-de-cobro?pais=rd",
    title: "Cuenta de cobro · Oakberry RD",
    description: "Envía tus datos y documentos para que procesemos tu pago. Toma 3 minutos.",
  },
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return paisDe((await searchParams).pais) === "rd" ? META_RD : META_CO;
}

// Landing pública: sin login y sin menú del portal. Solo escribe al enviar.
export default async function CuentaDeCobroPage({ searchParams }: Props) {
  const pais = paisDe((await searchParams).pais);

  if (pais === "rd") {
    const empresa = empresaRD();
    return (
      <div className="pub">
        <div className="pub-card">
          <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
          <h1 className="pub-title">Cuenta de cobro</h1>
          <SelectorPais base="/cuentas-de-cobro" pais="rd" publico />
          <p className="pub-sub">
            Para creadores, influencers y proveedores de <b>Oakberry República Dominicana</b>.
            Envía tus datos y documentos para que procesemos tu pago. Toma 3 minutos.
          </p>
          <FormCuentaCobroRD />
          <p className="pub-foot">
            Tus datos se usan solo para el trámite de pago y el reporte a la DGII. {empresa.nombre}
            {empresa.rnc ? <> · RNC {rncLegible(empresa.rnc)}</> : null}
          </p>
        </div>
      </div>
    );
  }

  const lista = await conceptos();
  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Cuenta de cobro</h1>
        <SelectorPais base="/cuentas-de-cobro" pais="co" publico />
        <p className="pub-sub">
          Envía tus datos y documentos para que Oakberry (ManelFoods) procese tu pago. Toma 2 minutos.
        </p>
        <FormCuentaCobro conceptos={lista} />
        <p className="pub-foot">Tus datos se usan solo para el trámite de pago. Oakberry Colombia · ManelFoods S.A.S.</p>
      </div>
    </div>
  );
}
