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
// Un envío del intake viaja como UN request (Server Action con multipart), y
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
// 4 MB y no 4,5: el request lleva además los campos de texto, los nombres de
// las casillas y las fronteras del multipart. El margen es para eso.
export const TOPE_ENVIO_BYTES = 4 * 1000 * 1000;

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
  // cifra nuestra sin relación con la que manda (ver TOPE_ENVIO_BYTES).
  if (file.size > TOPE_ENVIO_BYTES) {
    return `${etiqueta}: pesa ${pesoLegible(file.size)} y solo podemos recibir `
      + `${pesoLegible(TOPE_ENVIO_BYTES)} por envío. Si es una foto, tómala de nuevo con menos `
      + `resolución; si es un PDF escaneado, vuelve a guardarlo desde "Imprimir → Guardar como PDF".`;
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
  if (!esPdf || file.size > TOPE_ENVIO_BYTES) return false;
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
  // El peso del CONJUNTO también en el servidor. Hoy el borde de Vercel corta
  // antes (413) y esto casi nunca se alcanza a ejecutar; se pone igual porque la
  // regla no puede vivir solo en el navegador —el `accept` y el peso se saltan
  // desde la consola— y porque el día que los archivos suban por otra vía (sin
  // pasar por el request de la acción), este es el único que queda de pie.
  const pesado = motivoPorPesoTotal(archivos.map(({ file, clase }) => ({
    nombre: file.name, peso: file.size,
    etiqueta: clases.find((c) => c.clase === clase)?.label ?? file.name,
  })));
  if (pesado) problemas.push(pesado);
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

/** ¿Caben TODOS juntos? Devuelve el motivo del rechazo, o null.
 *
 *  Se mide el total y no archivo por archivo porque el tope es del REQUEST: tres
 *  documentos de 2 MB pasan uno a uno y el envío igual se cae. Se nombra el más
 *  pesado —que es el que hay que arreglar— y se dice qué hacer con él, porque
 *  "pesa mucho" sin salida es un proveedor que no vuelve (Regla 18). La salida
 *  existe de verdad: el envío entra sin ese documento y contabilidad manda el
 *  enlace de /completar para subirlo aparte.
 */
export function motivoPorPesoTotal(
  archivos: { nombre: string; peso: number; etiqueta: string }[],
): string | null {
  const total = archivos.reduce((a, x) => a + x.peso, 0);
  if (total <= TOPE_ENVIO_BYTES) return null;
  const gordo = archivos.reduce((a, x) => (x.peso > a.peso ? x : a), archivos[0]);
  return `Tus documentos juntos pesan ${pesoLegible(total)} y solo podemos recibir `
    + `${pesoLegible(TOPE_ENVIO_BYTES)} por envío. El más pesado es ${gordo.etiqueta} `
    + `(${gordo.nombre}, ${pesoLegible(gordo.peso)}): quítalo, manda el resto, y te enviamos `
    + `un enlace para subir ese solo. Si es un escaneo, guardarlo de nuevo desde `
    + `"Imprimir → Guardar como PDF" suele dejarlo en la décima parte.`;
}
