// DE DÓNDE SALIÓ UN PAGO, DICHO EN PALABRAS.
//
// Un pago del portal nace de tres sitios: una FACTURA DIAN, una CUENTA DE COBRO
// (o el gasto interno que nadie nos factura — servicios públicos, arriendos,
// impuestos) y el ADELANTO de una cotización. En la base eso son dos columnas:
// `pagos.origen` y, para lo que vino del intake, el `tipo` del documento.
//
// Se escribe acá, en un módulo PURO, porque la misma etiqueta la pintan el
// tablero, el historial y el Excel del consolidado. Con una copia por camino,
// el mismo pago se llamaría "cuenta de cobro" en pantalla y "Servicio público"
// en el Excel — y ese es exactamente el tipo de diferencia que hace que alguien
// crea que son dos gastos distintos.
import { TIPOS_GASTO } from "./gastos-periodicos";

/** Cómo se llama el documento que hay detrás de un pago.
 *
 *  `origen` es el carril (factura | cuenta_cobro | cotizacion) y `tipoDoc` es,
 *  cuando vino del intake, qué clase de gasto era. Un servicio público entra por
 *  el carril de las cuentas de cobro pero NO es una cuenta de cobro: decirle así
 *  en el consolidado esconde el gasto que más se repite. */
export function etiquetaOrigen(origen: string | null | undefined, tipoDoc?: string | null): string {
  if (origen === "cotizacion") return "Adelanto de cotización";
  if (origen === "factura" || !origen) return "Factura DIAN";
  if (tipoDoc && tipoDoc !== "cuenta_cobro") {
    // El label sale de la tabla de tipos de gasto, no de una lista paralela: el
    // día que se agregue un tipo, aparece acá solo.
    const t = TIPOS_GASTO.find((x) => x.valor === tipoDoc);
    if (t) return t.label;
  }
  return "Cuenta de cobro";
}

/** La misma etiqueta, para el sello chiquito que va al lado del nombre en el
 *  tablero. "Adelanto de cotización" no cabe en una columna de cuatro, y menos
 *  en un celular: lo que se recorta ahí es el NOMBRE DEL PROVEEDOR, que es
 *  justo lo que el sello viene a acompañar. Un tipo nuevo que no esté en esta
 *  lista cae a su label en minúscula — se ve largo, no se ve roto. */
const CORTAS: Record<string, string> = {
  cuenta_cobro: "cta. cobro", servicio_publico: "serv. público", arriendo: "arriendo",
  administracion: "admin.", seguro: "seguro", impuesto: "impuesto", otro: "otro gasto",
};
export function etiquetaOrigenCorta(origen: string | null | undefined, tipoDoc?: string | null): string {
  if (origen === "cotizacion") return "adelanto";
  if (origen === "factura" || !origen) return "factura";
  return CORTAS[tipoDoc ?? "cuenta_cobro"] ?? etiquetaOrigen(origen, tipoDoc).toLowerCase();
}

/** ¿Este pago tiene factura electrónica detrás? Lo pregunta quien decide si
 *  mostrar el listado de facturas o la referencia del documento. */
export const sinFacturaDian = (origen: string | null | undefined): boolean =>
  !!origen && origen !== "factura";
