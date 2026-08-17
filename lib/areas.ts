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
 *  que la bandeja pueda decir "falta el RUT" en vez de listar archivos sueltos.
 *
 *  Los 4 son OBLIGATORIOS para poder aprobar y pasar a Pagos. La certificación
 *  bancaria es la crítica: de ella sale la cuenta que va al CSV del banco, así
 *  que tiene que ser el documento que emite la entidad — no un Word ni un papel
 *  escrito a mano (el lector los rechaza y le pide al proveedor el real). */
export const CLASES_DOC = [
  { name: "doc_certificacion", clase: "certificacion_bancaria", label: "Certificación bancaria",
    ayuda: "La que emite tu banco. De ahí tomamos tu cuenta" },
  { name: "doc_rut", clase: "rut", label: "RUT",
    ayuda: "Actualizado (DIAN)" },
  { name: "doc_cedula", clase: "cedula", label: "Cédula",
    ayuda: "Del titular de la cuenta" },
  { name: "doc_soporte", clase: "soporte", label: "Documento soporte",
    ayuda: "Tu cuenta de cobro, cotización, contrato…" },
] as const;

/** Días de plazo de una cuenta de cobro: se pagan a 30 días desde que llega.
 *  Es política de la casa, no algo que el proveedor negocie en el formulario. */
export const PLAZO_CUENTA_COBRO_DIAS = 30;

/** Plazos que el proveedor pudo negociar para el SALDO de una cotización. */
export const PLAZOS_NEGOCIADOS = [
  { valor: 0, label: "Contado" },
  { valor: 8, label: "8 días" },
  { valor: 15, label: "15 días" },
  { valor: 30, label: "30 días" },
  { valor: 45, label: "45 días" },
  { valor: 60, label: "60 días" },
] as const;

/** Etiqueta legible de una clase guardada (para las bandejas). */
export function etiquetaClase(clase: string | undefined): string {
  return CLASES_DOC.find((c) => c.clase === clase)?.label ?? "Documento";
}
