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

// EL TOPE DE PESO NO LO PONEMOS NOSOTROS: LO PONE VERCEL.
//
// Vercel corta cualquier request de más de **4,5 MB** con un 413
// `FUNCTION_PAYLOAD_TOO_LARGE` — EN EL BORDE, antes de que la función exista.
// Comprobado contra producción el 21-ago-2026: 4,0 MB llega (405), 5,5 MB no
// llega (413). No se puede subir: `serverActions.bodySizeLimit` en
// `next.config.mjs` solo puede BAJARLO, y tenerlo en "15mb" fue exactamente lo
// que nos hizo creer que 15 MB cabían.
//
// Cómo se veía el bug: el proveedor adjuntaba sus documentos, le daba enviar, y
// la página se caía con "Se nos cayó la página" SIN código de error — no había
// código porque no hubo excepción del servidor: la petición nunca llegó. El
// validador del navegador, mientras tanto, le decía que 25 MB por archivo
// estaba bien. La regla del navegador tiene que ser la MISMA que la del borde,
// o el proveedor recibe un permiso que nadie va a honrar (Regla 18).
//
// ES POR ARCHIVO, no por envío: desde que cada documento sube en su propia
// petición (lib/intake-subida.ts) el tope dejó de ser para todo junto. Un envío
// con cuatro documentos de 3 MB pasa sin problema; uno solo de 5 MB, no.
//
// 4 MB y no 4,5: la petición lleva además el nombre del archivo, la clase y las
// fronteras del multipart. El margen es para eso.
export const TOPE_ARCHIVO_BYTES = 4 * 1000 * 1000;

/** Peso en la unidad que el proveedor entiende. "3,2 MB", no "3355443 bytes". */
export function pesoLegible(bytes: number): string {
  if (bytes >= 1000 * 1000) return (bytes / 1000 / 1000).toFixed(1).replace(".", ",") + " MB";
  return Math.max(1, Math.round(bytes / 1000)) + " KB";
}

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
  // Un solo archivo ya no puede pasar el tope del ENVÍO completo: si pasa, no
  // hay combinación posible de los otros que quepa. Decía 25 MB, que era una
  // cifra nuestra sin relación con la que manda (ver TOPE_ARCHIVO_BYTES).
  if (file.size > TOPE_ARCHIVO_BYTES) {
    return `${etiqueta}: pesa ${pesoLegible(file.size)} y solo podemos recibir `
      + `${pesoLegible(TOPE_ARCHIVO_BYTES)} por documento. Si es una foto, tómala de nuevo con menos `
      + `resolución; si es un PDF escaneado, vuelve a guardarlo desde "Imprimir → Guardar como PDF" `
      + `— eso suele dejarlo en la décima parte.`;
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
  if (!esPdf || file.size > TOPE_ARCHIVO_BYTES) return false;
  try {
    const txt = new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer()));
    return txt.includes("/Encrypt");
  } catch {
    return false;   // ante la duda, pasa: lo agarra el lector
  }
}
