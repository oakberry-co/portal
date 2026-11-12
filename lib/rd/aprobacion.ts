// EL CANDADO DE APROBACIÓN DE RD — qué falta para que un cobro pase a pago.
//
// Módulo PURO: la tarjeta lo usa para EXPLICAR el bloqueo antes del clic, y el
// servidor lo vuelve a correr contra la base en el momento de aprobar (entre que
// se pintó la página y el clic pudo cambiar algo). Una sola copia: dos copias de
// la misma regla es como se rompió el candado de Colombia.
//
// Lo que protege, en orden de plata:
//  1. EL DESVÍO DE PAGO. Si quien ya cobró antes manda OTRA cuenta, puede ser
//     legítimo (cambió de banco) o puede ser alguien que se hace pasar por él.
//     No se adivina: el aprobador confirma por otro canal y lo deja escrito.
//  2. EL TITULAR AJENO. La cuenta a nombre de otra persona se avisa; el parecido
//     de nombres solo SUGIERE (Regla 3), así que tampoco bloquea solo: pide
//     confirmación.
//  3. LOS DOCUMENTOS. Cédula/RNC y comprobante de cuenta la primera vez (o
//     heredados de un pago anterior a la MISMA cuenta); el soporte, siempre.
//  4. LA RETENCIÓN CONFIRMADA (aunque sea cero).

import { nombreComparable } from "@/lib/rd/identidad";

export type DocRD = { clase?: string; estado?: string; path?: string };

export type HistoriaCuenta = {
  /** Cuentas a las que ya se le PAGÓ a este número de identificación. */
  pagadas: { banco: string; num_cuenta: string }[];
};

export type CobroParaAprobar = {
  tipo_persona: "fisica" | "juridica";
  nombre: string;
  banco: string; num_cuenta: string; titular_cuenta: string;
  documentos: DocRD[];
  retencion_ok: boolean;
  ncf_proveedor: string | null;
};

export type Confirmaciones = { cambioCuenta: boolean; titularAjeno: boolean; motivo: string | null };

const llegó = (docs: DocRD[], clase: string) =>
  docs.some((d) => d.clase === clase && d.estado === "subido" && !!d.path);

const mismaCuenta = (a: { banco: string; num_cuenta: string }, b: { banco: string; num_cuenta: string }) =>
  a.banco === b.banco && a.num_cuenta.replace(/\D/g, "") === b.num_cuenta.replace(/\D/g, "");

/** ¿Ya se le pagó antes a esta misma cuenta? Entonces sus documentos de
 *  identidad y de cuenta ya fueron revisados una vez: no se le vuelven a exigir. */
export function cuentaConocida(c: CobroParaAprobar, h: HistoriaCuenta): boolean {
  return h.pagadas.some((p) => mismaCuenta(p, c));
}

/** Cambió de cuenta: tiene pagos anteriores y NINGUNO a esta cuenta. */
export function cambioDeCuenta(c: CobroParaAprobar, h: HistoriaCuenta): boolean {
  return h.pagadas.length > 0 && !cuentaConocida(c, h);
}

/** El titular de la cuenta no se parece a quien cobra. Solo un AVISO. */
export function titularAjeno(c: CobroParaAprobar): boolean {
  const a = nombreComparable(c.titular_cuenta), b = nombreComparable(c.nombre);
  if (!a || !b) return true;
  if (a === b) return false;
  // "Ana María Pérez" vs "Ana Pérez": comparten las palabras del titular.
  const pa = new Set(a.split(" ").filter((w) => w.length > 2));
  const pb = b.split(" ").filter((w) => w.length > 2);
  if (!pa.size || !pb.length) return true;   // nombres de puras sílabas cortas: que lo mire alguien
  const comunes = pb.filter((w) => pa.has(w)).length;
  return comunes < Math.min(2, pa.size, pb.length);
}

/** Documentos que FALTAN para aprobar (etiquetas para el humano). */
export function docsFaltanRD(c: CobroParaAprobar, h: HistoriaCuenta): string[] {
  const faltan: string[] = [];
  const conocida = cuentaConocida(c, h);
  if (!conocida && !llegó(c.documentos, "identificacion")) faltan.push("la cédula o RNC");
  if (!conocida && !llegó(c.documentos, "comprobante_cuenta")) faltan.push("el comprobante de la cuenta");
  if (!llegó(c.documentos, "soporte")) faltan.push("la cuenta de cobro o factura");
  return faltan;
}

/** El motivo por el que NO se puede aprobar, o null. Escrito para quien lo lee
 *  (Regla 18): qué pasa y qué hacer. */
export function bloqueoAprobacionRD(c: CobroParaAprobar, h: HistoriaCuenta, conf: Confirmaciones): string | null {
  if (c.tipo_persona === "juridica" && !c.ncf_proveedor) {
    return "Una empresa tiene que facturarle a la empresa de RD con NCF de crédito fiscal. Devuélvela pidiendo la factura con NCF.";
  }
  const faltan = docsFaltanRD(c, h);
  if (faltan.length) {
    return `Falta ${faltan.join(" y ")}. Devuélvela con el motivo para que la envíe completa`
         + (faltan.length && cambioDeCuenta(c, h) ? " (cambió de cuenta: sus documentos anteriores no cubren la nueva)." : ".");
  }
  if (cambioDeCuenta(c, h) && !conf.cambioCuenta) {
    return "Esta persona ya cobró antes a OTRA cuenta. Confírmale el cambio por teléfono o WhatsApp "
         + "(no respondiendo el mismo mensaje) y marca la casilla con lo que te dijo.";
  }
  if (titularAjeno(c) && !conf.titularAjeno) {
    return "La cuenta está a nombre de otra persona. Si está bien (p. ej. cobra a nombre de su empresa), márcalo y escribe por qué.";
  }
  if ((conf.cambioCuenta || conf.titularAjeno) && !(conf.motivo ?? "").trim()) {
    return "Escribe qué confirmaste y con quién: queda en la bitácora.";
  }
  if (!c.retencion_ok) {
    return "Falta confirmar las retenciones (aunque sean cero), para que se pague el valor correcto.";
  }
  return null;
}
