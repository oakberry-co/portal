// QUÉ ARCHIVO SE ACEPTA, Y POR QUÉ.
//
// No es una manía de formatos: cada regla acá evita un trabajo manual después.
//
//  - La CERTIFICACIÓN BANCARIA y el DOCUMENTO SOPORTE van en PDF o Word. La
//    certificación porque de ahí sale la cuenta a la que se manda plata y la lee
//    un OCR; el soporte porque es el papel que sustenta el pago y termina en el
//    archivo contable. Una foto de WhatsApp recomprimida no sirve para ninguno.
//  - La CÉDULA y el RUT sí aceptan foto: la mayoría llega desde el celular y
//    exigirles un PDF es pedirles que busquen un computador. Se leen a ojo.
//  - NINGUNO puede venir con clave. Un archivo cifrado no lo abre el lector, no
//    lo abre quien revisa y no lo abre el contador tres meses después.
//
// Se valida en el navegador (aviso inmediato) Y en el servidor (lo que manda).
// El del navegador es cortesía; el `accept` del <input> se salta arrastrando.

export type Formatos = "documento" | "libre";

const EXT_DOC = [".pdf", ".doc", ".docx"];
const EXT_IMG = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];

const ext = (n: string) => {
  const i = n.lastIndexOf(".");
  return i < 0 ? "" : n.slice(i).toLowerCase();
};

/** ¿Este archivo sirve para esta casilla? Devuelve el motivo del rechazo, o null. */
export function motivoRechazo(file: File, formatos: Formatos, etiqueta: string): string | null {
  const e = ext(file.name);
  const permitidas = formatos === "documento" ? EXT_DOC : [...EXT_DOC, ...EXT_IMG];
  if (!e) {
    return `${etiqueta}: el archivo no tiene extensión. Mándalo en PDF.`;
  }
  if (!permitidas.includes(e)) {
    return formatos === "documento"
      ? `${etiqueta}: solo aceptamos PDF o Word (${e} no sirve). Si le tomaste foto, ábrela y guárdala como PDF — cualquier celular lo hace desde "Imprimir → Guardar como PDF".`
      : `${etiqueta}: ese formato (${e}) no lo podemos abrir. Mándalo en PDF o como foto (JPG o PNG).`;
  }
  // 25 MB: por encima de eso casi siempre es un video o un escaneo sin comprimir.
  if (file.size > 25 * 1024 * 1024) {
    return `${etiqueta}: el archivo pesa más de 25 MB. Mándalo más liviano.`;
  }
  if (file.size === 0) {
    return `${etiqueta}: el archivo llegó vacío. Vuelve a adjuntarlo.`;
  }
  return null;
}

/** ¿El PDF viene cifrado? Se busca `/Encrypt`, que es lo que todo PDF con clave
 *  escribe en su tráiler. No se intenta abrirlo: acá solo se decide si entra.
 *
 *  Un Word con clave no se detecta por bytes (va cifrado entero, no deja marca
 *  legible). Se acepta y, si no abre, el revisor lo devuelve — es el caso raro. */
export async function tieneClave(file: File): Promise<boolean> {
  const esPdf = file.type.includes("pdf") || ext(file.name) === ".pdf";
  if (!esPdf || file.size > 25 * 1024 * 1024) return false;
  try {
    const txt = new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer()));
    return txt.includes("/Encrypt");
  } catch {
    return false;   // ante la duda, pasa: lo agarra el lector
  }
}

/** Revisa TODOS los archivos de un envío. Devuelve la lista de problemas (vacía
 *  = todo bien). Se usa en el servidor, que es donde la regla de verdad manda. */
export async function revisarArchivos(
  archivos: { file: File; clase: string }[],
  clases: readonly { clase: string; label: string; formatos: Formatos }[],
): Promise<string[]> {
  const problemas: string[] = [];
  for (const { file, clase } of archivos) {
    const def = clases.find((c) => c.clase === clase);
    // Un adjunto suelto ('otro') no tiene casilla: se le pide lo mínimo.
    const formatos: Formatos = def?.formatos ?? "libre";
    const etiqueta = def?.label ?? file.name;
    const m = motivoRechazo(file, formatos, etiqueta);
    if (m) { problemas.push(m); continue; }
    if (await tieneClave(file)) {
      problemas.push(`${etiqueta}: el PDF tiene contraseña y así no lo podemos abrir. `
        + `Ábrelo con la clave y vuelve a guardarlo sin candado (Archivo → Imprimir → Guardar como PDF).`);
    }
  }
  return problemas;
}
