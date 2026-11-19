// EL SELECTOR DE PAÍS (Colombia / República Dominicana), 19-nov-2026.
//
// Los dos países comparten las MISMAS pantallas —el formulario público
// /cuentas-de-cobro, Contabilidad › Cuentas de cobro y Contabilidad › Pagos—
// pero NO la plata: por debajo cada uno sigue en su tabla (cuentas_cobro /
// rd_cuentas_cobro). Así un cobro de RD nunca cae en el archivo de Davivienda,
// en la causación a Siigo ni en los avisos colombianos: los paga otra persona
// jurídica (Manel Foods Dominicana), con otra autoridad (DGII) y otra moneda.
//
// Son ENLACES, no un estado del navegador: el país vive en la URL (?pais=rd).
// Así el enlace que va por WhatsApp abre directo el formulario que es, recargar
// no te devuelve a Colombia, y el servidor carga solo la tabla del país en
// pantalla. Todo enlace pasa por ruta() (ambiente de pruebas).

import { ruta } from "@/lib/ruta";

export type Pais = "co" | "rd";

/** Lo que no sea exactamente "rd" es Colombia: los enlaces que ya circulan no llevan país. */
export function paisDe(v: string | string[] | undefined): Pais {
  return v === "rd" ? "rd" : "co";
}

const OPCIONES: { k: Pais; label: string; corto: string }[] = [
  { k: "co", label: "🇨🇴 Colombia", corto: "🇨🇴 Colombia" },
  { k: "rd", label: "🇩🇴 República Dominicana", corto: "🇩🇴 Rep. Dominicana" },
];

export function SelectorPais({ base, pais, conteo, publico }: {
  /** Ruta de la página sin país (Colombia). RD = la misma con ?pais=rd. */
  base: string;
  pais: Pais;
  /** Pendientes por país (el número chiquito); se omite si es 0 o no se sabe. */
  conteo?: Partial<Record<Pais, number>>;
  /** En el formulario público ocupa todo el ancho de la tarjeta. */
  publico?: boolean;
}) {
  return (
    <nav className={publico ? "pais-sel pais-pub" : "pais-sel"} aria-label="País">
      {OPCIONES.map((o) => {
        const n = conteo?.[o.k];
        return (
          <a key={o.k} href={ruta(o.k === "co" ? base : `${base}?pais=rd`)}
             className={pais === o.k ? "on" : ""} aria-current={pais === o.k ? "page" : undefined}>
            <span className="pais-largo">{o.label}</span><span className="pais-corto">{o.corto}</span>
            {n ? <i>{n}</i> : null}
          </a>
        );
      })}
    </nav>
  );
}
