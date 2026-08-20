// EL ARCHIVO DE PAGOS DE DAVIVIENDA — "Formato Excel Estándar".
//
// El banco no valida como una persona: una celda con "CUENTA DE AHORROS" donde
// espera "CA", o un "NIT" donde espera un 3, no es un aviso — es la fila
// rechazada, o peor, la plata puesta en otro lado. Acá vive la traducción de
// nuestros datos al formato del banco, más las revisiones que NO se pueden
// automatizar y hay que señalarle a un humano.
//
// Fuente: reglas del "Formato Excel Estándar" que entregó el banco (ago-2026).

// Relativo a propósito: los centinelas compilan este archivo suelto con `tsc`,
// que no resuelve el alias `@/`. Un import bonito que rompe la prueba no sirve.
import { limpiarTextoHumano } from "./texto";

export type FilaBanco = {
  nit: string; nombre: string | null;
  titular_nombre: string | null; titular_apellido: string | null;
  tipo_doc: string | null; num_doc: string | null; banco: string | null;
  tipo_cuenta: string | null; num_cuenta: string | null;
  correo: string | null; referencia: string | null; monto: number;
};

// ── 1. Tipo de identificación: numérico, máx 2 dígitos ──────────────────────
export const TIPO_ID: Record<string, string> = {
  CC: "1", CE: "2", NIT: "3", TI: "4", PASAPORTE: "5", PP: "5", PPT: "5",
  // 12 = NIT de PERSONA NATURAL. No se deduce solo: hay que saber que ese NIT
  // es de una persona y no de una empresa, y eso lo confirma un humano.
  NIT_PN: "12",
};

export function codigoTipoId(tipo: string | null | undefined): string {
  const t = (tipo ?? "").trim().toUpperCase().replace(/[.\s]/g, "");
  if (/^\d{1,2}$/.test(t)) return t;          // ya venía en código: no se toca
  return TIPO_ID[t] ?? "";
}

// ── 3. Tipo de producto o servicio: alfanumérico, máx 2 ─────────────────────
export const TIPO_PRODUCTO: Record<string, string> = {
  corriente: "CC", "cuenta corriente": "CC",
  ahorros: "CA", "cuenta de ahorros": "CA", "cuenta ahorros": "CA",
  daviplata: "DP",
  prepago: "TP", "tarjeta prepago maestro": "TP",
  deposito: "DE", "depositos electronicos": "DE", "deposito electronico": "DE",
};

export function codigoProducto(tipo: string | null | undefined): string {
  const t = sinTildes((tipo ?? "").trim().toLowerCase());
  if (/^(CC|CA|DP|TP|DE)$/i.test(t)) return t.toUpperCase();
  return TIPO_PRODUCTO[t] ?? "";
}

// ── 7. Texto que acepta el banco ────────────────────────────────────────────
export function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Quita tildes, cambia ñ→n y borra los signos que el banco rechaza.
 *  (Regla 7 del formato: . $ & % / ( ) = ? #). También recorta y colapsa
 *  espacios — regla 6. */
export function textoBanco(s: string | null | undefined): string {
  // ÚLTIMA barrera antes del banco. `limpiarTextoHumano` repara el mojibake y
  // borra los caracteres de control: un `PEÃA` salía como `PEAA` más un
  // carácter INVISIBLE que ni se ve en pantalla ni se nota al revisar el Excel,
  // y el banco recibe un titular que no es el de la cuenta. Se limpia también
  // acá —además de al guardar— porque el maestro tiene datos viejos y este
  // archivo mueve plata hoy.
  const limpio = limpiarTextoHumano(s) ?? "";
  return sinTildes(limpio.replace(/ñ/g, "n").replace(/Ñ/g, "N"))
    .replace(/[.$&%/()=?#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 2. Coherencia entre identificación y tipo de tercero ────────────────────
// Un apellido que dice "SAS" no es un apellido: es el sufijo de una razón
// social, y entonces el documento tiene que ser NIT.
const SUFIJOS = ["SAS", "S A S", "SA", "S A", "LTDA", "PH", "P H", "EU", "SCA",
                 "S C A", "SAC", "BIC", "ESP", "E S P", "SOCIEDAD", "CIA", "Y CIA"];

export function pareceRazonSocial(nombre: string, apellido: string): boolean {
  const t = textoBanco(`${nombre} ${apellido}`).toUpperCase();
  return SUFIJOS.some((s) => t === s || t.endsWith(" " + s));
}

// ── 4. Códigos de banco vigentes ────────────────────────────────────────────
/** Códigos con nota operativa: salen igual, pero se señalan. */
export const CODIGOS_CON_NOTA: Record<string, string> = {
  "507": "Nequi: el banco tiene nota de deshabilitación histórica para este código.",
};
/** 51 no está en la tabla de bancos externos: es el código de la casa (cuentas
 *  Davivienda, DaviPlata y Tarjeta Pagos). */
export const CODIGO_DAVIVIENDA = "51";

export type Aviso = { fila: number; quien: string; regla: string; detalle: string };

/** Todo lo que un humano tiene que mirar ANTES de subir el archivo. Nada de esto
 *  se corrige solo: corregirlo a ciegas es justo como se manda plata a otro
 *  lado (Regla 3: el parecido sugiere, nunca afirma). */
export function revisarFila(
  i: number, r: FilaBanco, codigoBanco: string, codigosValidos: Set<string>,
): Aviso[] {
  const avisos: Aviso[] = [];
  const quien = textoBanco(r.titular_nombre ?? r.nombre ?? r.nit) || r.nit;
  const nombre = textoBanco(r.titular_nombre ?? r.nombre ?? "");
  const apellido = textoBanco(r.titular_apellido ?? "");
  const tipo = codigoTipoId(r.tipo_doc);

  // Regla 2
  const esEmpresa = pareceRazonSocial(nombre, apellido);
  if (esEmpresa && tipo !== "3") {
    avisos.push({ fila: i, quien, regla: "2 · identificación vs tercero",
      detalle: `El nombre termina en sufijo de razón social pero el tipo quedó en ${tipo || "(vacío)"}. Debería ser 3 (NIT).` });
  }
  if (!esEmpresa && tipo === "3") {
    avisos.push({ fila: i, quien, regla: "2 · identificación vs tercero",
      detalle: "Tiene NIT (3) pero el nombre no parece una empresa. Si es persona natural con NIT, va 12; si es cédula, va 1. Confírmalo." });
  }
  if (!tipo) {
    avisos.push({ fila: i, quien, regla: "1 · tipo de identificación",
      detalle: `No se pudo traducir "${r.tipo_doc ?? "(vacío)"}" a código.` });
  }

  // Regla 3
  if (!codigoProducto(r.tipo_cuenta)) {
    avisos.push({ fila: i, quien, regla: "3 · tipo de producto",
      detalle: `No se pudo traducir "${r.tipo_cuenta ?? "(vacío)"}" a CC/CA/DP/TP/DE.` });
  }

  // Regla 4
  if (!codigoBanco) {
    avisos.push({ fila: i, quien, regla: "4 · código del banco",
      detalle: `"${r.banco ?? "(vacío)"}" no está en la tabla de bancos de Davivienda. ¿Está bien escrito?` });
  } else if (codigoBanco !== CODIGO_DAVIVIENDA && !codigosValidos.has(codigoBanco)) {
    avisos.push({ fila: i, quien, regla: "4 · código del banco",
      detalle: `El código ${codigoBanco} no aparece en la tabla vigente.` });
  } else if (CODIGOS_CON_NOTA[codigoBanco]) {
    avisos.push({ fila: i, quien, regla: "4 · código del banco",
      detalle: CODIGOS_CON_NOTA[codigoBanco] });
  }

  // Regla 5 — el que de verdad muerde
  if ((r.num_cuenta ?? "").startsWith("0")) {
    avisos.push({ fila: i, quien, regla: "5 · ceros a la izquierda",
      detalle: `La cuenta ${r.num_cuenta} empieza por cero. Va como TEXTO en el Excel; si alguien la reabre y la guarda como número, el cero se pierde y el banco recibe otra cuenta.` });
  }
  return avisos;
}
