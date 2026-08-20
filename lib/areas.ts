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
 *  escrito a mano (el lector los rechaza y le pide al proveedor el real).
 *
 *  `formatos` decide qué archivo se acepta (ver lib/documentos.ts):
 *    'documento' = PDF o Word. La certificación (la lee un OCR y de ahí sale la
 *                  cuenta) y el soporte (es el papel que sustenta el pago).
 *    'libre'     = además foto. Cédula y RUT llegan del celular y se leen a ojo;
 *                  exigirles PDF es mandarlos a buscar un computador. */
export const CLASES_DOC = [
  { name: "doc_certificacion", clase: "certificacion_bancaria", label: "Certificación bancaria",
    ayuda: "La que emite tu banco. De ahí tomamos tu cuenta", formatos: "documento" as const },
  { name: "doc_rut", clase: "rut", label: "RUT",
    ayuda: "Actualizado (DIAN)", formatos: "libre" as const },
  { name: "doc_cedula", clase: "cedula", label: "Cédula",
    ayuda: "Del titular de la cuenta", formatos: "libre" as const },
  { name: "doc_soporte", clase: "soporte", label: "Documento soporte",
    ayuda: "Tu cuenta de cobro, cotización, contrato…", formatos: "documento" as const },
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

/** Documento tal como quedó en `documentos` (JSONB) — lo mínimo para saber si
 *  llegó. Vive acá (módulo puro) para que las vistas de cliente lo importen sin
 *  arrastrar código de servidor. */
export type DocGuardado = { clase?: string; estado?: string; path?: string };

/** Qué documentos obligatorios FALTAN en un envío (devuelve sus etiquetas).
 *
 *  "Falta" incluye el que el proveedor adjuntó pero NO llegó a Drive
 *  (`estado='pendiente'`): en la bandeja no hay nada que abrir, así que para
 *  aprobar es como si no existiera.
 *
 *  Los envíos VIEJOS (sin `clase`, anteriores a los documentos tipados) no se
 *  pueden evaluar por clase: se dan por completos si trajeron al menos tantos
 *  archivos como clases se piden hoy. No se le exige a un proveedor una casilla
 *  que no existía cuando llenó el formulario. */
export function docsFaltantes(docs: DocGuardado[] | null | undefined): string[] {
  const lista = docs ?? [];
  const tipados = lista.filter((d) => d.clase && d.clase !== "otro");
  if (!tipados.length) {
    const subidos = lista.filter((d) => d.estado !== "pendiente" && (d.path ?? "") !== "");
    return subidos.length >= CLASES_DOC.length ? [] : CLASES_DOC.map((c) => c.label);
  }
  return CLASES_DOC
    .filter((c) => !tipados.some((d) => d.clase === c.clase && d.estado !== "pendiente" && (d.path ?? "") !== ""))
    .map((c) => c.label);
}
