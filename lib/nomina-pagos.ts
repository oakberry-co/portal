// PAGOS DE NÓMINA — lo que se lee de los dos Excel que sube RRHH/contabilidad.
//
// Dos archivos, dos preguntas distintas:
//   · el de EMPLEADOS dice A QUIÉN y A DÓNDE (cédula, nombre, cuenta, tienda);
//   · el de PAGO dice CUÁNTO (cédula + neto a depositar de esa quincena).
// La llave que los une es la CÉDULA. Nunca el nombre: dos «JUAN DAVID» en la
// misma tienda es lo normal, y una cédula es lo que el banco valida contra la
// cuenta (Regla 3: el parecido sugiere, nunca afirma).
//
// Las reglas que sostienen este módulo:
//  1. Las columnas se buscan por NOMBRE, no por posición (Regla 13 y 19): el
//     Excel de RRHH cambia de forma, le ponen títulos arriba, reordenan.
//  2. Vacío no es cero. Una celda de valor en blanco es «no la llené», y esa
//     persona NO entra al lote; un 0 escrito tampoco (no se transfieren ceros).
//  3. La cuenta es TEXTO. Si llega como número, Excel ya pudo comerse el cero
//     de la izquierda y no hay cómo saberlo: se avisa, no se adivina.
//  4. Nada se escribe sin que un humano vea qué va a cambiar (Regla 18).
//
// Módulo PURO (sin base ni sesión): lo prueba scripts/test_pagos_nomina.js.
// Imports relativos a propósito: el centinela lo compila suelto con `tsc`.

import ExcelJS from "exceljs";
import { pesos } from "./pesos";
import { bancoCanonico } from "./bancos";
import { limpiarTextoHumano, limpiarCorreo } from "./texto";

export type Problema = { fila: number; quien: string; detalle: string };

export const norm = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ── Documento de identidad ──────────────────────────────────────────────────
export type TipoDoc = "CC" | "CE" | "PPT" | "PASAPORTE" | "TI";
const TIPOS_DOC: Record<string, TipoDoc> = {
  cc: "CC", cedula: "CC", "cedula de ciudadania": "CC", "c c": "CC",
  ce: "CE", "cedula de extranjeria": "CE", "c e": "CE",
  ppt: "PPT", "permiso por proteccion temporal": "PPT", pep: "PPT",
  pasaporte: "PASAPORTE", pa: "PASAPORTE", pp: "PASAPORTE",
  ti: "TI", "tarjeta de identidad": "TI",
};
export const tipoDocDe = (s: unknown): TipoDoc | null => TIPOS_DOC[norm(s)] ?? null;

/** «PPT 5017896» → { PPT, 5017896 }; «1.000.930.239» → { null, 1000930239 }.
 *  El tipo solo sale del texto cuando viene ESCRITO como prefijo; un número
 *  pelado no dice si es cédula o cédula de extranjería, y eso lo decide la
 *  columna «Tipo de documento» o el humano en la vista previa. */
export function documentoDe(v: unknown): { tipo: TipoDoc | null; num: string } {
  const t = String(typeof v === "number" ? Math.round(v) : v ?? "").trim();
  // El número tiene que EMPEZAR por dígito: si no, la expresión perezosa toma
  // «P» como prefijo y «PT 5017896» como número (cazado por el centinela).
  const m = t.match(/^([A-Za-z.\s]+?)[\s.:-]*(\d[0-9A-Za-z.\-\s]*)$/);
  if (m && tipoDocDe(m[1])) {
    return { tipo: tipoDocDe(m[1]), num: m[2].replace(/[.\-\s]/g, "").toUpperCase() };
  }
  return { tipo: null, num: t.replace(/[.\-\s]/g, "").toUpperCase() };
}

/** ¿Este número de documento es plausible para su tipo? CC/TI/CE son solo
 *  dígitos; PPT y pasaporte admiten letras. */
export function documentoValido(tipo: TipoDoc, num: string): boolean {
  if (!num) return false;
  if (tipo === "CC" || tipo === "TI" || tipo === "CE") return /^\d{5,11}$/.test(num);
  return /^[0-9A-Z]{4,15}$/.test(num);
}

// ── Tipo de cuenta ──────────────────────────────────────────────────────────
export type TipoCuenta = "ahorros" | "corriente" | "daviplata" | "deposito";
const TIPOS_CUENTA: Record<string, TipoCuenta> = {
  ahorros: "ahorros", ahorro: "ahorros", "cuenta de ahorros": "ahorros", "cuenta ahorros": "ahorros",
  "cta ahorros": "ahorros", ca: "ahorros", "de ahorros": "ahorros",
  corriente: "corriente", "cuenta corriente": "corriente", "cta corriente": "corriente", cc: "corriente",
  daviplata: "daviplata", dp: "daviplata",
  deposito: "deposito", "deposito electronico": "deposito", "depositos electronicos": "deposito",
  de: "deposito", nequi: "deposito",
};
export const tipoCuentaDe = (s: unknown): TipoCuenta | null => TIPOS_CUENTA[norm(s)] ?? null;

// ── Punto (como lo escribe RRHH) → destino del maestro (P&L) ────────────────
// Tabla CERRADA y escrita a mano. El maestro de RRHH dice «109», «VIVA»,
// «CALLE 76»; el P&L necesita el destino exacto de Maestros. Un punto que no
// está acá es un problema que se muestra, no uno que se resuelve por parecido:
// equivocarlo es cargarle el sueldo a la tienda de al lado sin ningún error.
export const PUNTO_A_DESTINO: Record<string, string> = {
  "zona t": "Oakberry Zona T", "109": "Oakberry Calle 109", "calle 109": "Oakberry Calle 109",
  colina: "Oakberry Colina", andino: "Oakberry Andino", "plaza claro": "Oakberry Plaza Claro",
  unicentro: "Oakberry Unicentro", "titan plaza": "Oakberry Titan Plaza", titan: "Oakberry Titan Plaza",
  maloka: "Oakberry Maloka", "zona g": "Oakberry Zona G", "calle 140": "Oakberry Calle 140",
  "140": "Oakberry Calle 140",
  viva: "Oakberry Viva Barranquilla", "viva barranquilla": "Oakberry Viva Barranquilla",
  "calle 76": "Oakberry Baq calle 76", "76": "Oakberry Baq calle 76", "baq 76": "Oakberry Baq calle 76",
  "barranquilla 76": "Oakberry Baq calle 76",
  eventos: "EVENTOS",
  administrativo: "Administrativo", administrativos: "Administrativo", administracion: "Administrativo",
  oficina: "Administrativo", "oficina central": "Administrativo",
};

/** Punto escrito por RRHH (o destino ya escrito como en Maestros, o su
 *  short_code) → nombre del destino. `destinos` son los nombres y códigos
 *  activos del maestro. */
export function destinoDe(
  punto: unknown, destinos: { nombre: string; short_code: string | null }[],
): string | null {
  const n = norm(punto);
  if (!n) return null;
  const exacto = destinos.find((d) => norm(d.nombre) === n || (d.short_code && norm(d.short_code) === n));
  if (exacto) return exacto.nombre;
  const mapeado = PUNTO_A_DESTINO[n];
  return mapeado && destinos.some((d) => d.nombre === mapeado) ? mapeado : null;
}

// Periodo y concepto viven en ./nomina-periodo (sin dependencias): la pantalla
// los necesita y este módulo arrastra exceljs, que no tiene por qué ir al navegador.
export { CONCEPTOS, ETIQUETA_CONCEPTO, periodoValido, mesDePeriodo, etiquetaPeriodo, type Concepto } from "./nomina-periodo";

// ── Lectura genérica de la hoja ─────────────────────────────────────────────
type Hoja = { filas: { n: number; get: (k: string) => unknown; esNumero: (k: string) => boolean }[];
              tiene: Set<string>; hoja: string };

/** Busca el encabezado (la primera fila con la columna llave, en las primeras
 *  20) y devuelve las filas con acceso por nombre de columna. Lee la PRIMERA
 *  hoja que tenga encabezado: el Excel de RRHH trae otras pestañas (WA-LOCALES). */
async function leerHoja(buf: ArrayBuffer, columnas: Record<string, string[]>, llave: string): Promise<Hoja> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  for (const ws of wb.worksheets) {
    let filaEnc = 0;
    for (let i = 1; i <= Math.min(ws.rowCount, 20); i++) {
      const vals = (ws.getRow(i).values as unknown[]) ?? [];
      if (vals.some((v) => columnas[llave].includes(norm(textoCelda(v))))) { filaEnc = i; break; }
    }
    if (!filaEnc) continue;
    const idx: Record<string, number> = {};
    ((ws.getRow(filaEnc).values as unknown[]) ?? []).forEach((v, i) => {
      const n = norm(textoCelda(v));
      for (const [clave, alias] of Object.entries(columnas)) {
        if (idx[clave] === undefined && alias.includes(n)) idx[clave] = i;
      }
    });
    const filas: Hoja["filas"] = [];
    for (let i = filaEnc + 1; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      const cel = (k: string) => (idx[k] === undefined ? null : valorCelda(r.getCell(idx[k]).value));
      filas.push({ n: i, get: cel, esNumero: (k) => typeof cel(k) === "number" });
    }
    return { filas, tiene: new Set(Object.keys(idx)), hoja: ws.name };
  }
  throw new Error(`No encontré la columna «${columnas[llave][0]}» en ninguna hoja del archivo.`);
}

/** exceljs entrega fórmulas como {formula,result}, texto enriquecido como
 *  {richText}, hipervínculos (un correo) como {text,hyperlink}. */
function valorCelda(v: unknown): unknown {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return valorCelda(o.result);
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return o.text;
    if (v instanceof Date) return v;
  }
  return v;
}
const textoCelda = (v: unknown): string => String(valorCelda(v) ?? "");
const txt = (v: unknown): string | null => limpiarTextoHumano(v == null ? null : String(v));

// ── Excel de EMPLEADOS ──────────────────────────────────────────────────────
// Acepta el maestro de RRHH tal como sale («activos manel foods nomina en
// vivo.xlsx») más las columnas de banco que hay que agregarle.
const COL_EMPLEADOS: Record<string, string[]> = {
  doc: ["cedula", "numero de documento", "documento", "no documento", "numero documento", "identificacion", "cc"],
  tipoDoc: ["tipo de documento", "tipo documento", "tipo doc", "tipo de identificacion"],
  nombreCompleto: ["nombres y apellidos", "nombre completo", "apellidos y nombres", "nombre"],
  nombres: ["nombres", "primer nombre y segundo nombre"],
  apellidos: ["apellidos", "primer apellido y segundo apellido"],
  banco: ["banco", "entidad bancaria", "banco de pago"],
  tipoCuenta: ["tipo de cuenta", "tipo cuenta", "tipo de producto"],
  cuenta: ["numero de cuenta", "cuenta", "no cuenta", "numero cuenta", "cuenta bancaria", "n cuenta"],
  punto: ["punto", "tienda", "destino", "sede", "centro de costo"],
  cargo: ["cargo actual", "cargo"],
  correo: ["email", "correo", "correo electronico", "e mail"],
  activo: ["activo", "estado"],
};

export type FilaEmpleado = {
  fila: number; num_doc: string; tipo_doc: TipoDoc; tipoAsumido: boolean;
  nombre_completo: string; nombres: string | null; apellidos: string | null;
  banco: string | null; tipo_cuenta: TipoCuenta | null; num_cuenta: string | null;
  destino: string; cargo: string | null; correo: string | null; activo: boolean;
  /** Esta fila trajo cuenta y venía en una celda de número: el cero de la
   *  izquierda pudo perderse antes de llegar acá. */
  cuentaComoNumero: boolean;
};
export type LecturaEmpleados = {
  filas: FilaEmpleado[]; problemas: Problema[]; hoja: string;
  /** Columnas AUSENTES no borran lo que ya hay en el maestro (vacío ≠ ausente). */
  tiene: { banco: boolean; tipoCuenta: boolean; cuenta: boolean; nombresSeparados: boolean };
};

export async function leerEmpleados(
  buf: ArrayBuffer, destinos: { nombre: string; short_code: string | null }[],
): Promise<LecturaEmpleados> {
  const h = await leerHoja(buf, COL_EMPLEADOS, "doc");
  if (!h.tiene.has("nombreCompleto") && !(h.tiene.has("nombres") && h.tiene.has("apellidos"))) {
    throw new Error("El archivo no trae el nombre: hace falta «Nombres y Apellidos» (o «Nombres» y «Apellidos» por separado).");
  }
  if (!h.tiene.has("punto")) {
    throw new Error("El archivo no trae la columna «Punto» (la tienda o «Administrativo»). Sin ella no se sabe a qué P&L cae el sueldo.");
  }
  const filas: FilaEmpleado[] = [];
  const problemas: Problema[] = [];
  const vistos = new Map<string, number>();

  for (const r of h.filas) {
    const crudo = r.get("doc");
    if (crudo == null || String(crudo).trim() === "") continue;   // fila vacía
    const nombres = txt(r.get("nombres"));
    const apellidos = txt(r.get("apellidos"));
    const nombreCompleto = txt(r.get("nombreCompleto")) ?? ([apellidos, nombres].filter(Boolean).join(" ") || null);
    const quien = nombreCompleto ?? String(crudo);
    const mal = (detalle: string) => problemas.push({ fila: r.n, quien, detalle });

    const d = documentoDe(crudo);
    const tipoCol = h.tiene.has("tipoDoc") ? tipoDocDe(r.get("tipoDoc")) : null;
    if (h.tiene.has("tipoDoc") && r.get("tipoDoc") != null && String(r.get("tipoDoc")).trim() && !tipoCol) {
      mal(`El tipo de documento «${r.get("tipoDoc")}» no se reconoce (CC, CE, PPT, pasaporte, TI).`); continue;
    }
    if (tipoCol && d.tipo && tipoCol !== d.tipo) {
      mal(`El documento dice ${d.tipo} pero la columna de tipo dice ${tipoCol}.`); continue;
    }
    const tipo: TipoDoc = tipoCol ?? d.tipo ?? "CC";
    if (!documentoValido(tipo, d.num)) { mal(`El documento «${String(crudo).trim()}» no es válido para ${tipo}.`); continue; }
    if (vistos.has(d.num)) { mal(`La cédula ${d.num} está repetida (también en la fila ${vistos.get(d.num)}).`); continue; }
    vistos.set(d.num, r.n);
    if (!nombreCompleto) { mal("Falta el nombre."); continue; }

    const destino = destinoDe(r.get("punto"), destinos);
    if (!destino) {
      mal(`El punto «${r.get("punto") ?? ""}» no corresponde a ningún destino de Maestros. Escríbelo como en Maestros (ej. «Oakberry Zona T» o «Administrativo»).`);
      continue;
    }

    // Banco, tipo y número van juntos: dos de tres no sirven para pagar.
    let banco: string | null = null, tipoCuenta: TipoCuenta | null = null, cuenta: string | null = null;
    const bRaw = txt(r.get("banco")), tRaw = txt(r.get("tipoCuenta"));
    const cRaw = r.get("cuenta");
    const cTxt = cRaw == null ? "" : String(typeof cRaw === "number" ? cRaw.toFixed(0) : cRaw).trim();
    const algo = !!(bRaw || tRaw || cTxt);
    if (algo) {
      banco = bancoCanonico(bRaw);
      tipoCuenta = tipoCuentaDe(tRaw);
      cuenta = cTxt.replace(/[\s\-.]/g, "");
      // Nequi y DaviPlata: el «banco» es el producto. Si el tipo vino vacío se
      // puede afirmar, porque no hay otro tipo de producto en esas entidades.
      if (!tipoCuenta && banco === "DAVIPLATA") tipoCuenta = "daviplata";
      if (!tipoCuenta && banco === "NEQUI") tipoCuenta = "deposito";
      const faltan = [!banco && (bRaw ? `el banco «${bRaw}» no está en la lista` : "falta el banco"),
                      !tipoCuenta && (tRaw ? `el tipo de cuenta «${tRaw}» no se reconoce (ahorros / corriente / daviplata)` : "falta el tipo de cuenta"),
                      !/^\d{4,20}$/.test(cuenta) && (cuenta ? `la cuenta «${cTxt}» tiene algo que no son dígitos` : "falta el número de cuenta")]
        .filter(Boolean);
      if (faltan.length) { mal(`Datos bancarios incompletos: ${faltan.join("; ")}.`); continue; }
    }

    const act = norm(r.get("activo"));
    filas.push({
      fila: r.n, num_doc: d.num, tipo_doc: tipo, tipoAsumido: !tipoCol && !d.tipo,
      nombre_completo: nombreCompleto, nombres, apellidos,
      banco, tipo_cuenta: tipoCuenta, num_cuenta: cuenta || null, destino,
      cargo: txt(r.get("cargo")), correo: limpiarCorreo(txt(r.get("correo"))),
      activo: !["no", "inactivo", "retirado", "false", "0"].includes(act),
      cuentaComoNumero: algo && typeof cRaw === "number",
    });
  }
  return { filas, problemas, hoja: h.hoja, tiene: {
    banco: h.tiene.has("banco"), tipoCuenta: h.tiene.has("tipoCuenta"), cuenta: h.tiene.has("cuenta"),
    nombresSeparados: h.tiene.has("nombres") && h.tiene.has("apellidos"),
  } };
}

// ── Excel de PAGO ───────────────────────────────────────────────────────────
// El de la liquidación de nómina (Siigo Nómina o el de RRHH): cédula + neto.
const COL_PAGO: Record<string, string[]> = {
  doc: ["cedula", "numero de documento", "documento", "identificacion", "no documento", "numero documento", "cc"],
  nombre: ["nombres y apellidos", "nombre completo", "empleado", "nombre"],
  neto: ["neto a pagar", "neto pagar", "total a pagar", "valor a pagar", "valor a depositar",
         "neto", "valor neto", "total neto", "a pagar", "valor"],
  devengado: ["total devengado", "devengado", "total devengos", "devengos"],
  punto: ["punto", "tienda", "destino", "sede", "centro de costo"],
  nota: ["nota", "observacion", "observaciones", "detalle"],
};

export type FilaPago = {
  fila: number; num_doc: string; nombre: string | null; neto: number; devengado: number | null;
  /** Punto del Excel si vino (si no, el del maestro de beneficiarios). */
  puntoCrudo: string | null; nota: string | null;
};
export type LecturaPago = { filas: FilaPago[]; problemas: Problema[]; hoja: string; vacias: number };

export async function leerPago(buf: ArrayBuffer): Promise<LecturaPago> {
  const h = await leerHoja(buf, COL_PAGO, "doc");
  if (!h.tiene.has("neto")) {
    throw new Error("El archivo no trae la columna del valor a depositar («Neto a pagar», «Total a pagar» o «Valor»).");
  }
  const filas: FilaPago[] = [];
  const problemas: Problema[] = [];
  let vacias = 0;
  for (const r of h.filas) {
    const crudo = r.get("doc");
    if (crudo == null || String(crudo).trim() === "") continue;
    const d = documentoDe(crudo);
    const nombre = txt(r.get("nombre"));
    const quien = nombre ?? d.num;
    // Una fila de TOTALES trae un número donde va la cédula y otro gigante en
    // el neto. Una cédula de menos de 5 dígitos no existe: se ignora sin ruido.
    if (/total/i.test(String(crudo))) continue;
    if (!/^(?=.*\d)[0-9A-Z]{5,15}$/.test(d.num)) {
      problemas.push({ fila: r.n, quien, detalle: `El documento «${String(crudo).trim()}» no es válido.` });
      continue;
    }
    const neto = pesos(r.get("neto"));
    if (neto === null) { vacias++; continue; }             // vacío = esta persona no va en este lote
    if (Number.isNaN(neto)) { problemas.push({ fila: r.n, quien, detalle: "El valor a pagar no es un número." }); continue; }
    if (neto <= 0) {
      if (neto === 0) { vacias++; continue; }
      problemas.push({ fila: r.n, quien, detalle: "El valor a pagar viene en negativo. Un descuento mayor que el pago no se transfiere: revísalo con nómina." });
      continue;
    }
    const dev = pesos(r.get("devengado"));
    if (dev !== null && (Number.isNaN(dev) || dev < neto)) {
      problemas.push({ fila: r.n, quien, detalle: `El devengado (${dev}) no puede ser menor que el neto (${neto}). ¿Columnas cruzadas?` });
      continue;
    }
    filas.push({ fila: r.n, num_doc: d.num, nombre, neto: Math.round(neto * 100) / 100,
                 devengado: dev, puntoCrudo: txt(r.get("punto")), nota: txt(r.get("nota")) });
  }
  return { filas, problemas, hoja: h.hoja, vacias };
}

/** Últimos 4 de una cuenta, para pantalla y bitácora: la cuenta completa no
 *  viaja a lugares que no la necesitan. */
export const ultimos4 = (c: string | null | undefined) => (c ? "••••" + c.slice(-4) : "—");
