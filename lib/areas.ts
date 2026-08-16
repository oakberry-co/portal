// Áreas de la empresa que puede elegir un proveedor en los portales públicos.
//
// Ojo: NO es `maestro_destinos`. El maestro tiene ~50 entradas (una por tienda) y
// eso es la clasificación CONTABLE que hace el equipo adentro. Un proveedor
// externo no sabe —ni tiene por qué saber— si su servicio se carga a
// "Oakberry Ciudad Jardín" o a "BODBOG". Solo sabe con qué área habló.
// Lista corta y cerrada; contabilidad afina el destino real en la bandeja.
export const AREAS = [
  "MERCADEO",
  "OPERACIONES",
  "FINANZAS",
  "RECURSOS HUMANOS",
  "CONTABILIDAD",
] as const;

export type Area = (typeof AREAS)[number];

/** Clases de documento que se piden en los portales públicos. El `name` es el
 *  campo del formulario; la `clase` queda guardada en `documentos` (JSONB) para
 *  que la bandeja pueda decir "falta el RUT" en vez de listar archivos sueltos. */
export const CLASES_DOC = [
  { name: "doc_certificacion", clase: "certificacion_bancaria", label: "Certificación bancaria",
    ayuda: "Del banco, con el número de cuenta" },
  { name: "doc_rut", clase: "rut", label: "RUT",
    ayuda: "Actualizado (DIAN)" },
  { name: "doc_cedula", clase: "cedula", label: "Cédula",
    ayuda: "Del titular de la cuenta" },
  { name: "doc_soporte", clase: "soporte", label: "Documento soporte",
    ayuda: "Tu cuenta de cobro, cotización, contrato…" },
] as const;

/** Etiqueta legible de una clase guardada (para las bandejas). */
export function etiquetaClase(clase: string | undefined): string {
  return CLASES_DOC.find((c) => c.clase === clase)?.label ?? "Documento";
}
