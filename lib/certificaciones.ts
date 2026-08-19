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
// Módulo PURO (sin base ni sesión): se importa en cliente para pintar el aviso
// y en servidor para bloquear. El enforcement real es el servidor.

/** Lo que el lector sacó de la certificación de ESTE envío (null = nunca llegó). */
export type CertEstado = {
  id: number;
  estado: string;            // pendiente | valida | ilegible | no_es_certificacion
  motivo: string | null;
  banco: string | null;
  num_cuenta: string | null;
  aplicada: boolean;         // ¿su cuenta se escribió en el maestro?
  cuenta_anterior: string | null;  // la que el NIT ya tenía (cambio de cuenta)
  leido_en: string | null;
  // La cuenta que un HUMANO leyó del documento y escribió. Es la que manda.
  cuenta_verificada: string | null;
  verificada_por: string | null;
};

/** Dos números de cuenta, ¿son el mismo? Ceros a la izquierda y separadores no
 *  cuentan: el banco imprime '05314486074' y la gente escribe '5314486074'. */
export function mismaCuenta(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const y = (b ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return x.length > 0 && x === y;
}

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
    SELECT cb.id, cb.estado, cb.motivo, cb.banco, cb.num_cuenta, cb.aplicada,
           cb.cuenta_anterior, cb.leido_en::text AS leido_en,
           cb.cuenta_verificada, cb.verificada_por
      FROM certificacion_bancaria cb
     WHERE cb.origen_tipo = '${origen}' AND cb.origen_id = ${refId}
     ORDER BY cb.id DESC LIMIT 1) cert ON TRUE`;
}

/** Los 4 últimos dígitos, que es como se habla de una cuenta sin exponerla. */
export function cola(num: string | null | undefined): string {
  const n = (num ?? "").replace(/\D/g, "");
  return n ? "•••" + n.slice(-4) : "—";
}

/** ¿Por qué NO se puede aprobar este envío? `null` = se puede.
 *
 *  Devuelve el texto que ve el humano: tiene que decirle qué hacer, no solo que
 *  no puede (Regla 18 — un loop humano que no cierra quema la confianza).
 *
 *  Ojo con el orden: lo que habilita el pago es la CERTIFICACIÓN, no lo que haya
 *  hoy en el maestro. La cuenta se escribe en el maestro AL APROBAR (ver
 *  lib/cuenta-certificada.ts), así que exigirla antes sería pedirle al revisor
 *  el resultado de la acción que está a punto de hacer. */
export function bloqueoAprobacion(
  docsFaltan: string[], cert: CertEstado | null, cuenta: CuentaMaestro,
): string | null {
  if (docsFaltan.length) {
    return `Faltan documentos: ${docsFaltan.join(", ")}. Pídeselos al proveedor antes de aprobar.`;
  }
  if (!cert) {
    return "No hay certificación bancaria registrada para este envío: sin ella no sabemos a qué cuenta pagar. "
         + "Pídele al proveedor que la vuelva a enviar por el portal.";
  }
  if (cert.estado === "pendiente") {
    return "La certificación bancaria todavía no se ha leído (el lector corre cada 15 minutos). Intenta en un rato.";
  }
  if (cert.estado !== "valida") {
    return `La certificación no sirve: ${cert.motivo ?? "no se pudo validar"} `
         + "Escríbele al proveedor pidiéndole el documento que emite su banco.";
  }
  if (!(cert.num_cuenta ?? "").trim()) {
    return "La certificación se dio por válida pero no quedó con número de cuenta. "
         + "Vuelve a correr el lector (scripts/leer_certificaciones.py) sobre este documento.";
  }
  // El caso peligroso: el NIT ya tenía otra cuenta. No se aprueba hasta que
  // alguien diga si el cambio es real (el intake es público).
  if (cert.cuenta_anterior && !cert.aplicada) {
    return `Cambió la cuenta: este NIT ya tenía la cuenta ${cola(cert.cuenta_anterior)} y la certificación trae `
         + `${cola(cert.num_cuenta)}. Confirma el cambio antes de aprobar.`;
  }
  // EL PASO HUMANO. El OCR ayuda, no decide: a esa cuenta se le manda plata, y
  // ningún lector acierta el 100% de los formatos. Alguien tiene que abrir el
  // documento y escribir el número. Es lo último que se exige, para que el
  // revisor no lo haga hasta que todo lo demás esté en orden.
  if (!(cert.cuenta_verificada ?? "").trim()) {
    return "Falta el paso final: abre la certificación y escribe el número de cuenta que ves. "
         + "Lo que leyó el sistema no basta para mover plata.";
  }
  // Estado raro (la aplicó alguien y el maestro quedó sin número): no se calla.
  if (cert.aplicada && !(cuenta?.num_cuenta ?? "").trim()) {
    return "La cuenta certificada figura como aplicada pero el proveedor no la tiene en el maestro. "
         + "Revísalo en Maestros › Cuentas bancarias antes de aprobar.";
  }
  return null;
}
