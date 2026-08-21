// CÓMO SE LEE LA PLATA ESCRITA POR HUMANOS.
//
// Vive aparte porque ya son DOS los caminos que la necesitan y no puede haber
// dos versiones: el Excel de retenciones que llena el contador
// (lib/retenciones-excel.ts) y el total que se lee de una cotización o cuenta de
// cobro (lib/valor-documento.ts). El día que difieran, una de las dos va a leer
// nueve mil ochocientos setenta donde la otra lee nueve con ochenta y siete.
//
// Módulo PURO: se importa en cliente y en servidor.

/** Lee un número en pesos. Devuelve `null` si la celda está VACÍA (que no es lo
 *  mismo que cero) y `NaN` si trae algo que no es un número. */
export function pesos(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  // Celda con fórmula: exceljs entrega { formula, result }.
  if (typeof v === "object" && v !== null && "result" in (v as Record<string, unknown>)) {
    return pesos((v as { result: unknown }).result);
  }
  const t = String(v).trim();
  if (t === "" || t === "-") return null;

  // CÓMO SE ESCRIBE LA PLATA EN COLOMBIA: el punto separa miles y la coma marca
  // los decimales ('1.234.567,50'). Pero el archivo pasa por manos y por Excel,
  // así que también llega a la gringa ('1,234,567.50') o pelado ('1234567').
  //
  // La regla: el ÚLTIMO separador que venga seguido de 1 o 2 dígitos es el
  // decimal; todo lo demás son miles. `9.870` son nueve mil ochocientos setenta
  // —no 9,87— y confundirlos es retener mil veces menos de lo que toca.
  const limpio = t.replace(/[$\s]/g, "");
  const ultimo = Math.max(limpio.lastIndexOf(","), limpio.lastIndexOf("."));
  const decimales = ultimo >= 0 ? limpio.length - ultimo - 1 : 0;
  const esDecimal = ultimo >= 0 && decimales >= 1 && decimales <= 2;

  const entera = (esDecimal ? limpio.slice(0, ultimo) : limpio).replace(/[.,]/g, "");
  const fraccion = esDecimal ? limpio.slice(ultimo + 1) : "";
  if (!/^-?\d*$/.test(entera) || !/^\d*$/.test(fraccion)) return NaN;

  const n = Number(entera + (fraccion ? "." + fraccion : ""));
  return Number.isFinite(n) ? n : NaN;
}
