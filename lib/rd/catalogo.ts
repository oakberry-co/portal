// CATÁLOGO DE LAS CUENTAS DE COBRO DE REPÚBLICA DOMINICANA.
//
// Módulo PURO: conceptos, bancos, monedas, documentos y cómo se lee la plata.
// Lo importan el formulario público, la bandeja y el export, para que los tres
// hablen de lo mismo con las mismas palabras.
//
// Por qué una lista propia y no `maestro_conceptos`: ese maestro es de
// ManelFoods (Colombia) y de cada concepto cuelga una retención COLOMBIANA. La
// empresa de RD es otra persona jurídica, reporta a la DGII y no a la DIAN, y
// lo que se le cobra hoy es casi todo mercadeo (creadores, influencers,
// alianzas). Mezclar los dos maestros es como una tarifa de ReteFuente termina
// aplicada a un influencer de Santo Domingo.

import { pesos } from "@/lib/pesos";
import { enLetras } from "@/lib/letras";

export const ZONA_RD = "America/Santo_Domingo";   // UTC-4, sin horario de verano

/** `tipo606` = «Tipo de bienes y servicios comprados» del formato 606 de la DGII
 *  (02 = gastos por trabajos, suministros y servicios). `isr606` = «Tipo de
 *  retención en ISR» (2 = honorarios por servicios independientes). Son la
 *  PROPUESTA para el borrador del 606: lo confirma el contador de RD. */
export const CONCEPTOS_RD = [
  { id: "ugc", label: "Contenido UGC (videos o fotos para la marca)", evidencia: true, tipo606: "02", isr606: "2" },
  { id: "influencer", label: "Publicación de influencer (post, reel, historia)", evidencia: true, tipo606: "02", isr606: "2" },
  { id: "embajador", label: "Embajador de marca", evidencia: true, tipo606: "02", isr606: "2" },
  { id: "produccion", label: "Producción audiovisual o fotografía", evidencia: true, tipo606: "02", isr606: "2" },
  { id: "diseno", label: "Diseño o servicios creativos", evidencia: false, tipo606: "02", isr606: "2" },
  { id: "alianza", label: "Alianza o activación con otra marca", evidencia: false, tipo606: "02", isr606: "2" },
  { id: "evento", label: "Evento o logística", evidencia: false, tipo606: "02", isr606: "2" },
  { id: "otro", label: "Otro servicio", evidencia: false, tipo606: "02", isr606: "2" },
] as const;
export type ConceptoRD = (typeof CONCEPTOS_RD)[number]["id"];

export function concepto(id: string | null) {
  return CONCEPTOS_RD.find((c) => c.id === id) ?? null;
}

/** Bancos y asociaciones donde un dominicano tiene su cuenta. Lista CERRADA a
 *  propósito: con texto libre, "Popular", "BPD" y "Banco Popular Dominicano" son
 *  tres bancos para cualquier cruce. La salida "Otro" existe porque una lista
 *  sin escape deja a alguien sin cobrar; lo que entre por ahí se revisa. */
export const BANCOS_RD = [
  "Banco Popular Dominicano", "Banreservas", "Banco BHD", "Scotiabank",
  "Banco Santa Cruz", "Banco Promerica", "Banesco", "Banco Caribe", "Banco BDI",
  "Banco Vimenca", "Banco López de Haro", "Banco Lafise", "Banco Ademi",
  "Citibank", "Qik Banco Digital", "Asociación Popular (APAP)",
  "Asociación Cibao (ACAP)", "Asociación La Nacional",
] as const;

export const MONEDAS_RD = ["DOP", "USD"] as const;
export type MonedaRD = (typeof MONEDAS_RD)[number];

/** Documentos del envío. La cédula y el comprobante de cuenta se piden la
 *  primera vez; quien ya cobró con LA MISMA cuenta los hereda (ver
 *  `docsParaAprobar`). El soporte se pide siempre: es lo que se está cobrando.
 *  Todos aceptan foto: en RD el comprobante de cuenta suele ser una captura de
 *  la app del banco, y pedir PDF sería un muro (Regla 18). */
export const CLASES_DOC_RD = [
  { name: "doc_id", clase: "identificacion", label: "Cédula o RNC",
    ayuda: "Foto clara de los dos lados, o el certificado del RNC", formatos: "libre" as const },
  { name: "doc_cuenta", clase: "comprobante_cuenta", label: "Comprobante de tu cuenta",
    ayuda: "Certificación del banco o captura de la app donde se vean el titular y el número", formatos: "libre" as const },
  { name: "doc_soporte", clase: "soporte", label: "Tu cuenta de cobro o factura",
    ayuda: "El documento de este cobro (si tienes NCF, la factura con NCF)", formatos: "libre" as const },
] as const;

export function etiquetaDocRD(clase: string | undefined): string {
  return CLASES_DOC_RD.find((c) => c.clase === clase)?.label ?? "Documento";
}

const fmt = {
  DOP: new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  USD: new Intl.NumberFormat("es-DO", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

/** RD$1,250.00 · US$350.00. NUNCA se suma DOP con USD (ni con COP): cada
 *  total de la bandeja va por moneda. */
export function plata(n: number | null | undefined, moneda: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (moneda === "USD" ? fmt.USD : fmt.DOP).format(n);
}

/** Lee la plata como la escribe un dominicano ('RD$1,250.00'), un colombiano
 *  ('1.250') o pelada ('1250'). Usa el MISMO lector que el resto del portal
 *  (lib/pesos.ts: el último separador con 1-2 dígitos detrás es el decimal);
 *  solo le quita antes el prefijo de moneda, que `pesos` no conoce. */
export function montoRD(v: unknown): number | null {
  if (v == null) return null;
  return pesos(String(v).replace(/RD|US|DOP|USD/gi, ""));
}

/** Redondeo a centavos sin el error de coma flotante de 1.005 → 1.00. */
export function centavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** El valor en letras, con la moneda correcta: el lector colombiano dice
 *  "PESOS" a secas, y en US$ eso miente. */
export function letrasRD(n: number, moneda: string): string {
  const base = enLetras(Math.trunc(n)).replace(/\s*(DE\s+)?PESOS$/, "");
  const cts = Math.round((n - Math.trunc(n)) * 100);
  const mon = moneda === "USD" ? "DÓLARES" : "PESOS DOMINICANOS";
  const de = /MILL(ÓN|ONES)$/.test(base) ? " DE" : "";
  return `${base}${de} ${mon}` + (cts ? ` CON ${String(cts).padStart(2, "0")}/100` : "");
}

/** Mes de hoy en Santo Domingo, 'AAAA-MM'. La VM y Vercel viven en UTC: sin la
 *  zona, lo enviado el último día del mes después de las 8 pm caería al mes
 *  siguiente. */
export function mesRD(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_RD, year: "numeric", month: "2-digit" }).format(d);
}

/** Los meses que un proveedor puede elegir como período del servicio: este y
 *  los dos anteriores. Más atrás ya es un cobro viejo que conviene que alguien
 *  mire antes de que entre (se escribe por WhatsApp). */
export function mesesElegibles(d: Date = new Date()): string[] {
  const [y, m] = mesRD(d).split("-").map(Number);
  return [0, 1, 2].map((k) => {
    const t = new Date(Date.UTC(y, m - 1 - k, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
               "septiembre", "octubre", "noviembre", "diciembre"];
export function mesLegible(aaaamm: string): string {
  const [y, m] = aaaamm.slice(0, 7).split("-").map(Number);
  return `${MESES[m - 1] ?? "?"} ${y}`;
}

/** Referencia que ve todo el mundo: CCRD-12. Distinta de CC-12 (Colombia) para
 *  que nadie cruce un envío de RD con uno de ManelFoods. */
export const refRD = (id: number) => `CCRD-${id}`;
