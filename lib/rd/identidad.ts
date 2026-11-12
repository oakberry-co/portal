// IDENTIDAD EN REPÚBLICA DOMINICANA: cédula, RNC, teléfono.
//
// Módulo PURO (sin base ni sesión): lo usan el formulario público, el servidor
// y el centinela `scripts/test_rd_identidad.js`. Una sola copia de cada regla.
//
// Por qué importa: el número de identificación es la llave con la que la
// empresa de RD reporta cada pago a la DGII (formato 606) y con la que la
// bandeja detecta que alguien ya cobró antes y a qué cuenta. Una cédula con
// guiones en un envío y sin guiones en el siguiente son dos personas distintas
// para la base — la misma trampa que el NIT con dígito de verificación en
// Colombia (lib/nit.ts), que dejó $37 M sin pagar.

export type TipoId = "cedula" | "rnc" | "pasaporte";

/** Solo los dígitos. '001-1391820-5' → '00113918205'. */
export function soloDigitosRD(v: string): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Cédula dominicana: 11 dígitos, el último verifica por Luhn (JCE).
 *
 *  OJO: el dígito verificador NO es una prueba de que la cédula no exista. Hay
 *  cédulas viejas válidas que no pasan el Luhn (python-stdnum carga una lista
 *  de excepciones de cientos). Por eso quien llama trata `false` como AVISO
 *  ("revisa el número") y deja seguir confirmando — nunca como un muro: un
 *  creador con una cédula de las raras no podría cobrar (Regla 18). */
export function cedulaVerifica(cedula: string): boolean {
  const d = soloDigitosRD(cedula);
  if (d.length !== 11) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    let p = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    if (p > 9) p -= 9;
    suma += p;
  }
  return (10 - (suma % 10)) % 10 === Number(d[10]);
}

/** RNC: 9 dígitos, el último verifica con pesos 7-9-8-6-5-4-3-2 módulo 11 (DGII).
 *  Ejemplo de la DGII: 1-01-85004-3. Mismo criterio que la cédula: un RNC que no
 *  verifica se avisa, no se bloquea. */
export function rncVerifica(rnc: string): boolean {
  const d = soloDigitosRD(rnc);
  if (d.length !== 9) return false;
  const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
  const s = pesos.reduce((a, w, i) => a + w * Number(d[i]), 0) % 11;
  return ((10 - s) % 9) + 1 === Number(d[8]);
}

/** Forma canónica del número según su tipo. Cédula y RNC: solo dígitos (los
 *  ceros a la izquierda SON parte de la cédula: '001…' no es '1…'). Pasaporte:
 *  letras y dígitos en mayúscula. */
export function idCanonico(tipo: TipoId, v: string): string {
  if (tipo === "pasaporte") return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return soloDigitosRD(v);
}

/** Qué está mal con el número, en palabras para quien lo escribió, o null si
 *  la LONGITUD sirve. El dígito verificador va aparte (`verificaId`): avisa,
 *  no rechaza. */
export function problemaId(tipo: TipoId, v: string): string | null {
  const c = idCanonico(tipo, v);
  if (!c) return "Falta el número de identificación.";
  if (tipo === "cedula" && c.length !== 11)
    return `Una cédula tiene 11 dígitos y llegaron ${c.length}. Escríbela como aparece en tu cédula (con o sin guiones).`;
  if (tipo === "rnc" && c.length !== 9)
    return `Un RNC tiene 9 dígitos y llegaron ${c.length}. Si eres persona física y no tienes RNC, elige «Cédula».`;
  if (tipo === "pasaporte" && (c.length < 6 || c.length > 15))
    return "El número de pasaporte no parece completo.";
  return null;
}

/** ¿El dígito verificador cuadra? Para pasaporte no hay regla: siempre true. */
export function verificaId(tipo: TipoId, v: string): boolean {
  if (tipo === "cedula") return cedulaVerifica(v);
  if (tipo === "rnc") return rncVerifica(v);
  return true;
}

/** Teléfono dominicano en forma canónica '1' + área + 7 dígitos ('18095551234'),
 *  o null si no es un número de RD. Las áreas de RD son 809, 829 y 849.
 *
 *  Se guarda con el 1 adelante porque así lo pide wa.me — el `celular_wa` de
 *  cupones anteponía 57 en duro y ningún WhatsApp habría llegado a un +1. */
export function telefonoRD(v: string): string | null {
  let d = soloDigitosRD(v);
  if (d.length === 10) d = "1" + d;
  if (d.length !== 11 || d[0] !== "1") return null;
  return ["809", "829", "849"].includes(d.slice(1, 4)) ? d : null;
}

/** '18095551234' → '(809) 555-1234'. */
export function telefonoLegible(t: string | null): string {
  const d = soloDigitosRD(t ?? "");
  if (d.length !== 11) return t ?? "";
  return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
}

/** NCF que trae el proveedor en SU factura.
 *
 *  Formato: serie B + tipo de 2 dígitos + 8 de secuencia (11 caracteres), o el
 *  e-CF: E + tipo + 10 (13 caracteres). Para que la empresa pueda tomar el gasto
 *  y el ITBIS, el comprobante tiene que ser de CRÉDITO FISCAL (01 / 31) o de los
 *  regímenes especiales y gubernamental (14, 15 / 44, 45). Un 02/32 (consumo)
 *  es válido como comprobante pero no sirve para el gasto: se avisa. */
export type ProblemaNcf = { error?: string; aviso?: string; ncf?: string };

const TIPOS_OK = new Set(["01", "14", "15", "31", "44", "45"]);
const TIPOS_CONSUMO = new Set(["02", "32"]);

export function revisarNcf(v: string): ProblemaNcf {
  const ncf = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!ncf) return {};
  const b = /^B(\d{2})\d{8}$/.exec(ncf);
  const e = /^E(\d{2})\d{10}$/.exec(ncf);
  const tipo = b?.[1] ?? e?.[1];
  if (!tipo) {
    return { error: "El NCF no tiene la forma correcta: empieza por B y lleva 11 caracteres "
                  + "(B0100000001), o por E y lleva 13 si es electrónico (E310000000001)." };
  }
  if (TIPOS_CONSUMO.has(tipo)) {
    return { ncf, aviso: "Ese NCF es de CONSUMO (tipo " + tipo + "). Para que la empresa pueda "
                       + "registrar el gasto lo necesitamos de CRÉDITO FISCAL (B01 o E31)." };
  }
  if (!TIPOS_OK.has(tipo)) {
    return { error: "Ese tipo de NCF (" + tipo + ") no corresponde a una factura de venta a una empresa. "
                  + "Pide a quien te factura un comprobante de crédito fiscal (B01 o E31)." };
  }
  return { ncf };
}

/** Comparación de nombres para avisar (NUNCA para afirmar, Regla 3) que el
 *  titular de la cuenta no es quien cobra. Sin tildes, sin mayúsculas, sin
 *  signos y sin espacios dobles. */
export function nombreComparable(s: string | null): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
