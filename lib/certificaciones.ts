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

/** ¿Una es la otra con el prefijo del banco delante? Davivienda certifica
 *  '0570006270388827' y en el maestro está '6270388827': la MISMA cuenta en el
 *  formato largo. No se puede dar por buena sola —el prefijo también podría
 *  esconder otra cuenta— pero sí hay que decirlo con esas palabras, porque
 *  "cambió la cuenta •••8827 por •••8827" se lee como que el portal delira. */
export function unaEsLaOtraConPrefijo(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").replace(/\D/g, "");
  const y = (b ?? "").replace(/\D/g, "");
  if (x.length < 8 || y.length < 8 || x === y) return false;
  return x.endsWith(y) || y.endsWith(x);
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
  // SENTINELA. Si la consulta que trae `cert` no seleccionó `cuenta_verificada`,
  // el campo llega `undefined` y este candado lo lee como "nadie la verificó":
  // bloquea SIEMPRE, sin decir por qué. Pasó — el guard de aprobación tenía su
  // propia copia del sub-select y se quedó atrás. `to_jsonb` incluye toda
  // columna seleccionada (como null si está vacía), así que la AUSENCIA de la
  // llave sólo puede ser un bug de código. Se grita, no se asume.
  if (cert && !("cuenta_verificada" in cert)) {
    throw new Error("Bug: la consulta de la certificación no trae 'cuenta_verificada'. "
                  + "Ármala con sqlCertificacion() en vez de copiar el LEFT JOIN LATERAL.");
  }
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
  // EL PASO HUMANO, Y VA PRIMERO. El OCR ayuda, no decide: a esa cuenta se le
  // manda plata y ningún lector acierta el 100% de los formatos. Alguien abre el
  // documento y escribe el número.
  //
  // Antes esto iba DESPUÉS del cambio de cuenta y quedaba un callejón sin
  // salida: no se podía confirmar el cambio sin verificar, y la verificación no
  // se mostraba hasta resolver el cambio. Además el orden correcto es este:
  // hasta que un humano no lea el papel no se sabe siquiera SI cambió — lo que
  // leyó el OCR puede estar mal.
  if (!(cert.cuenta_verificada ?? "").trim()) {
    return "Falta el paso final: abre la certificación y escribe el número de cuenta que ves. "
         + "Lo que leyó el sistema no basta para mover plata.";
  }
  // El caso peligroso: el NIT ya tenía otra cuenta. No se aprueba hasta que
  // alguien diga si el cambio es real (el intake es público). Se compara contra
  // la cuenta VERIFICADA —la que un humano leyó—, no contra la del OCR: es la
  // que de verdad va a viajar al banco.
  const cuentaFinal = (cert.cuenta_verificada ?? "").trim();
  if (cert.cuenta_anterior && !cert.aplicada && !mismaCuenta(cert.cuenta_anterior, cuentaFinal)) {
    // Mismo final = casi seguro la misma cuenta con el prefijo del banco. Se
    // sigue exigiendo confirmación humana, pero se muestran COMPLETAS: el
    // revisor tiene el documento al lado y necesita comparar, no adivinar entre
    // dos colas idénticas ("cambió •••8827 por •••8827" se lee como un error).
    if (unaEsLaOtraConPrefijo(cert.cuenta_anterior, cuentaFinal)) {
      return `El certificado trae ${cuentaFinal} y en el maestro está ${cert.cuenta_anterior}: `
           + "terminan igual, o sea que casi seguro es la MISMA cuenta con el prefijo del banco delante. "
           + "Confirma cuál es la que va al banco y sigue.";
    }
    return `Cambió la cuenta: este NIT ya tenía la cuenta ${cola(cert.cuenta_anterior)} y la certificación trae `
         + `${cola(cuentaFinal)}. Confirma el cambio antes de aprobar.`;
  }
  // Estado raro (la aplicó alguien y el maestro quedó sin número): no se calla.
  if (cert.aplicada && !(cuenta?.num_cuenta ?? "").trim()) {
    return "La cuenta certificada figura como aplicada pero el proveedor no la tiene en el maestro. "
         + "Revísalo en Maestros › Cuentas bancarias antes de aprobar.";
  }
  return null;
}
