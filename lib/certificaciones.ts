// LA PUERTA DE APROBACIÓN DEL INTAKE.
//
// Aprobar una cuenta de cobro o una cotización no es un visto bueno estético:
// es lo que mete plata en el archivo del banco. Por eso la aprobación tiene
// candados y aquí viven, en un solo lugar, para que la bandeja MUESTRE lo mismo
// que el servidor EXIGE (si la UI y el guard divergen, el equipo aprende a
// pelearse con un botón que no explica por qué no funciona).
//
// Los candados, en orden:
//   1. los 4 documentos obligatorios, subidos de verdad a Drive;
//   2. la certificación bancaria leída y VÁLIDA (la emite el banco, no el
//      proveedor), con número de cuenta;
//   3. si el NIT ya tenía otra cuenta, el cambio confirmado por un humano;
//   4. y el paso final: un humano ABRIÓ el documento y ESCRIBIÓ la cuenta.
// Aprobar es además lo que ESCRIBE esa cuenta en el maestro de pagos.
//
// EL MONTO NO ES UN CANDADO, ES UNA ALARMA. Se coteja contra el documento
// soporte (lib/valor-documento.ts) y cuando no cuadra la bandeja lo GRITA, con
// los montos que sí trae el papel al lado — pero no bloquea. Quien decide es el
// humano, que para eso tiene el botón de ajustar el monto. Decisión de Daniel,
// 21-ago-2026: la máquina avisa, no manda.
//
// Módulo PURO (sin base ni sesión): se importa en cliente para pintar el aviso
// y en servidor para bloquear. El enforcement real es el servidor.

/** Lo que el lector sacó de la certificación de ESTE envío (null = nunca llegó). */
export type CertEstado = {
  id: number;
  estado: string;            // pendiente | valida | ilegible | no_es_certificacion
  motivo: string | null;
  banco: string | null;
  tipo_cuenta: string | null;
  num_cuenta: string | null;
  aplicada: boolean;         // ¿su cuenta se escribió en el maestro?
  cuenta_anterior: string | null;  // la que el NIT ya tenía (cambio de cuenta)
  leido_en: string | null;
  // Lo que un HUMANO leyó del documento y escribió. Es lo que manda y lo que
  // entra al maestro al aprobar: los TRES datos, no solo el número.
  cuenta_verificada: string | null;
  banco_verificado: string | null;
  tipo_verificado: string | null;
  verificada_por: string | null;
};



/** La cuenta que hoy tiene el proveedor en el maestro (la que iría al banco). */
export type CuentaMaestro = {
  banco: string | null;
  tipo_cuenta: string | null;
  num_cuenta: string | null;
  certificada: boolean;
} | null;

/** SQL del sub-select de la certificación de un envío. `origen` es literal del
 *  código (nunca entrada del usuario) y `refId` la columna con el id. */
export function sqlCertificacion(origen: "cuenta_cobro" | "cotizacion", refId: string): string {
  return `LEFT JOIN LATERAL (
    SELECT cb.id, cb.estado, cb.motivo, cb.banco, cb.tipo_cuenta, cb.num_cuenta, cb.aplicada,
           cb.cuenta_anterior, cb.leido_en::text AS leido_en,
           cb.cuenta_verificada, cb.banco_verificado, cb.tipo_verificado, cb.verificada_por
      FROM certificacion_bancaria cb
     WHERE cb.origen_tipo = '${origen}' AND cb.origen_id = ${refId}
     ORDER BY cb.id DESC LIMIT 1) cert ON TRUE`;
}

/** Los 4 últimos dígitos, que es como se habla de una cuenta sin exponerla. */
export function cola(num: string | null | undefined): string {
  const n = (num ?? "").replace(/\D/g, "");
  return n ? "•••" + n.slice(-4) : "—";
}

/** El único motivo de bloqueo que la bandeja NO repite en rojo: el formulario de
 *  la cuenta está justo encima pidiéndola, y decirlo dos veces es lo que hacía
 *  ver el trámite trancado cuando en realidad espera diez segundos de alguien.
 *  Se exporta como constante para compararlo por identidad — no por texto, que
 *  es como estas cosas se desincronizan al cambiar una coma. */
export const FALTA_CUENTA =
  "Falta la cuenta bancaria: escribe banco, tipo y número leyéndolos de la certificación. "
  + "Sin cuenta, el pago no tiene a dónde ir.";

/** Lo que hace falta para decidir si un envío se puede aprobar. */
export type Aprobacion = {
  docsFaltan: string[];
  cert: CertEstado | null;
  cuenta: CuentaMaestro;
  recurrente?: boolean;
};

/** ¿Por qué NO se puede aprobar este envío? `null` = se puede.
 *
 *  DOS COSAS, no más (21-ago-2026). Antes eran seis peldaños —el estado del OCR,
 *  el choque contra lo leído, el cambio de cuenta y sus dos salidas— y aprobar
 *  una cuenta de cobro se había vuelto un trámite de cinco pasos. La cuenta se
 *  ESCRIBE, no se valida: quien revisa tiene el documento delante y es mejor
 *  fuente que cualquier lector.
 *
 *  Lo que queda no es validación, es "el campo está lleno":
 *    1. los documentos que ese carril pide, subidos de verdad a Drive;
 *    2. una cuenta en el maestro — sin ella el archivo del banco no tiene a
 *       dónde mandar la plata y la fila desaparece sin un solo error.
 *
 *  El texto que devuelve es el que lee un humano: tiene que decirle qué hacer,
 *  no solo que no puede (Regla 18). */
export function bloqueoAprobacion(a: Aprobacion): string | null {
  const { docsFaltan, cuenta } = a;
  if (docsFaltan.length) {
    return `Faltan documentos: ${docsFaltan.join(", ")}. Pídeselos al proveedor antes de aprobar.`;
  }
  if (!(cuenta?.num_cuenta ?? "").trim()) return FALTA_CUENTA;
  return null;
}
