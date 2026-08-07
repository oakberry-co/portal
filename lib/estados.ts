// Máquina de estados de una factura. Cada avance exige un evento humano autorizado.
// El orden es estricto: no se salta un paso (las guardas lo impiden).

export const ESTADOS = [
  "capturada",      // recién sincronizada desde BQ
  "clasificada",    // humano puso concepto + destino + plazo
  "retenciones_ok", // humano validó las retenciones
  "aprobada_pago",  // aprobada para pagar (cae al portal de pagos)
  "pagada",         // el pagador confirmó el pago
  "causada",        // autorizada y causada en Siigo
] as const;

export type Estado = (typeof ESTADOS)[number];

const SIGUIENTE: Record<Estado, Estado | null> = {
  capturada: "clasificada",
  clasificada: "retenciones_ok",
  retenciones_ok: "aprobada_pago",
  aprobada_pago: "pagada",
  pagada: "causada",
  causada: null,
};

export function puedeAvanzar(de: Estado, a: Estado): boolean {
  return SIGUIENTE[de] === a;
}

/** Rol requerido para autorizar cada transición. */
export const ROL_REQUERIDO: Record<Estado, string> = {
  capturada: "conciliador",     // -> clasificada
  clasificada: "conciliador",   // -> retenciones_ok
  retenciones_ok: "conciliador",// -> aprobada_pago
  aprobada_pago: "pagador",     // -> pagada
  pagada: "causador",           // -> causada
  causada: "admin",
};

/** Etiquetas legibles para la UI. */
export const ETIQUETA: Record<Estado, string> = {
  capturada: "Por clasificar",
  clasificada: "Clasificada",
  retenciones_ok: "Retenciones OK",
  aprobada_pago: "Aprobada para pago",
  pagada: "Pagada",
  causada: "Causada",
};
