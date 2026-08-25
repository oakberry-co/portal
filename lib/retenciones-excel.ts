// EL EXCEL DE RETENCIONES QUE VUELVE.
//
// El equipo baja las facturas de la semana, escribe las retenciones a mano en el
// Excel —que es donde saben trabajar— y lo vuelve a subir. Acá se lee.
//
// Las tres reglas que sostienen esto, y que son todo el diseño:
//
//  1. LA LLAVE ES EL CUFE, no la posición de la fila. Alguien va a ordenar por
//     proveedor, borrar las filas que no le tocan o pegar solo un pedazo — y
//     todo eso tiene que seguir funcionando. Una fila sin CUFE reconocible NO se
//     adivina por nombre y valor: se reporta (Regla 3, el parecido sugiere pero
//     nunca afirma; y ya medimos que el 45,7% de las facturas comparten NIT y
//     total con una gemela).
//  2. VACÍO NO ES CERO. Una celda en blanco es "no la llené"; un 0 escrito es
//     "acá no se retiene", que es una decisión y hay que poder tomarla. Si se
//     confundieran, subir el archivo a medio llenar confirmaría en cero todo lo
//     que falta — y eso se paga de más.
//  3. NADA SE ESCRIBE SIN QUE UN HUMANO VEA QUÉ VA A CAMBIAR. Se lee, se arma el
//     plan, se muestra, y se aplica si la persona lo confirma (Regla 18).
//
// Lo que el archivo trae son PESOS, no porcentajes: es lo que se exportó y es lo
// que el banco descuenta. Un número que parece porcentaje se rechaza en vez de
// interpretarse — multiplicar por error una tarifa por el total es la clase de
// equivocación que nadie nota hasta que el proveedor reclama.

import ExcelJS from "exceljs";
import { pesos } from "./pesos";

export type FilaExcel = {
  fila: number; cufe: string;
  rf: number | null; ri: number | null; ric: number | null;
  otros: number | null; otrosConcepto: string | null; observaciones: string | null;
};

export type Problema = { fila: number; quien: string; detalle: string };

/** Encabezados que se aceptan para cada columna. Se comparan sin tildes ni
 *  mayúsculas, porque el archivo pasa por manos y por Excel. */
const COLUMNAS: Record<string, string[]> = {
  cufe: ["cufe", "cufe ref", "cufe referencia", "referencia"],
  rf: ["retefuente", "rete fuente", "retencion en la fuente", "rte fuente"],
  ri: ["reteiva", "rete iva", "rte iva"],
  ric: ["reteica", "rete ica", "rte ica"],
  otros: ["otros", "otros valor", "otro descuento", "descuento"],
  otrosConcepto: ["otros concepto", "concepto otros", "motivo otros"],
  observaciones: ["observaciones", "observacion", "nota", "notas"],
};

const norm = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type Lectura = {
  filas: FilaExcel[]; problemas: Problema[]; hoja: string;
  /** Qué columnas traía el archivo. Una columna AUSENTE no es una columna vacía:
   *  si el Excel no tiene "Otros", ese campo no se toca. Sin esto, subir el
   *  archivo borraría los descuentos manuales que no viajan en él. */
  tiene: { otros: boolean; observaciones: boolean };
};

/** Lee el archivo y devuelve lo que trae, SIN tocar la base. */
export async function leerExcel(buf: ArrayBuffer): Promise<Lectura> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("El archivo no tiene ninguna hoja.");

  // El encabezado no siempre está en la fila 1: la gente le pone un título
  // arriba. Se busca la primera fila que tenga una celda que diga CUFE.
  let filaEnc = 0;
  for (let i = 1; i <= Math.min(ws.rowCount, 20); i++) {
    const vals = (ws.getRow(i).values as unknown[]) ?? [];
    // La fila del encabezado se reconoce por la columna de la LLAVE, y esa
    // columna tiene varios nombres aceptados (ver COLUMNAS.cufe): desde que el
    // archivo lleva también lo que no tiene factura DIAN se llama "CUFE / Ref".
    // Buscar el literal "cufe" aquí dejaba el archivo nuevo sin encabezado
    // reconocible y el error decía "no encontré la columna CUFE" — teniéndola.
    if (vals.some((v) => COLUMNAS.cufe.includes(norm(v)))) { filaEnc = i; break; }
  }
  if (!filaEnc) {
    throw new Error("No encontré la columna «CUFE / Ref». Sube el mismo Excel que bajaste "
      + "de Conciliación — esa columna es la que identifica cada documento, y sin ella "
      + "no se puede saber a cuál corresponde cada retención.");
  }

  const enc = (ws.getRow(filaEnc).values as unknown[]) ?? [];
  const idx: Record<string, number> = {};
  enc.forEach((v, i) => {
    const n = norm(v);
    for (const [clave, alias] of Object.entries(COLUMNAS)) {
      if (idx[clave] === undefined && alias.includes(n)) idx[clave] = i;
    }
  });
  if (idx.rf === undefined && idx.ri === undefined && idx.ric === undefined) {
    throw new Error("El archivo no tiene ninguna columna de retención "
      + "(ReteFuente, ReteIVA o ReteICA). ¿Es el Excel de Conciliación?");
  }

  const filas: FilaExcel[] = [];
  const problemas: Problema[] = [];
  const cel = (r: ExcelJS.Row, i: number | undefined) => (i === undefined ? null : r.getCell(i).value);
  const txt = (v: unknown) => {
    const t = String(v ?? "").trim();
    return t === "" ? null : t;
  };

  for (let i = filaEnc + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const cufe = String(cel(r, idx.cufe) ?? "").trim();
    if (!cufe) continue;                       // fila vacía o de totales: se ignora

    const nums: Record<string, number | null> = {};
    let malo = false;
    for (const k of ["rf", "ri", "ric", "otros"] as const) {
      const v = pesos(cel(r, idx[k]));
      if (v !== null && Number.isNaN(v)) {
        problemas.push({ fila: i, quien: cufe.slice(0, 12) + "…",
          detalle: `La celda de ${k.toUpperCase()} tiene algo que no es un número.` });
        malo = true;
      } else if (v !== null && v < 0) {
        problemas.push({ fila: i, quien: cufe.slice(0, 12) + "…",
          detalle: `${k.toUpperCase()} viene en negativo. Las retenciones se escriben en positivo.` });
        malo = true;
      } else nums[k] = v;
    }
    if (malo) continue;

    filas.push({
      fila: i, cufe,
      rf: nums.rf ?? null, ri: nums.ri ?? null, ric: nums.ric ?? null,
      otros: nums.otros ?? null,
      otrosConcepto: txt(cel(r, idx.otrosConcepto)),
      observaciones: txt(cel(r, idx.observaciones)),
    });
  }
  return { filas, problemas, hoja: ws.name,
           tiene: { otros: idx.otros !== undefined, observaciones: idx.observaciones !== undefined } };
}

/** ¿Este número parece un PORCENTAJE escrito donde van pesos?
 *
 *  Una retención de 90 pesos sobre una factura de 3 millones no existe: es un
 *  2,5 que alguien escribió pensando en la tarifa. Interpretarlo sería inventar
 *  un dato; se rechaza la fila y se le dice a la persona qué pasó. */
export function pareceTarifa(valor: number, total: number): boolean {
  return valor > 0 && valor <= 100 && total > 50_000;
}
