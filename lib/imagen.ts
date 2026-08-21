// LA FOTO DEL CELULAR SE ALIVIANA ANTES DE MANDARLA.
//
// El tope del envío es de 4 MB (ver TOPE_ENVIO_BYTES en lib/documentos.ts) y una
// foto recién tomada con un celular de hoy pesa entre 3 y 8 MB ella sola. Sin
// esto, el proveedor que fotografía su cédula NO PUEDE ENVIAR — y antes ni
// siquiera se enteraba: la página se le caía.
//
// Solo se tocan las FOTOS (cédula y RUT, las casillas 'libre'). Los PDF no se
// re-comprimen: la certificación bancaria la lee un OCR y el soporte termina en
// el archivo contable, así que se mandan tal cual llegaron.
//
// 1800 px de lado mayor y calidad 0,82: un documento sigue leyéndose a ojo (que
// es para lo que se usa) y baja de ~5 MB a ~400 KB. Se conserva la ORIENTACIÓN
// de la foto (`imageOrientation: "from-image"`); sin eso, media cédula de iPhone
// llegaría acostada, porque el giro vive en el EXIF y el canvas lo ignora.
//
// NUNCA lanza y NUNCA empeora: ante cualquier falla —un HEIC que el navegador no
// sabe decodificar, un canvas bloqueado— devuelve el archivo ORIGINAL y deja que
// el cheque de peso decida con un mensaje que sí se entiende.

const LADO_MAX = 1800;
const CALIDAD = 0.82;

/** Debajo de esto no se toca: ya cabe, y re-codificar solo perdería nitidez. */
const NO_VALE_LA_PENA = 900 * 1000;

const esFoto = (f: File) =>
  f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

export async function comprimirFoto(file: File): Promise<File> {
  if (!esFoto(file) || file.size <= NO_VALE_LA_PENA) return file;
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(bmp.width * escala);
    lienzo.height = Math.round(bmp.height * escala);
    const ctx = lienzo.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) =>
      lienzo.toBlob(r, "image/jpeg", CALIDAD));
    // Si el resultado no es más liviano, el original gana: una foto ya
    // optimizada (las de WhatsApp lo están) puede ENGORDAR al re-codificarla.
    if (!blob || blob.size >= file.size) return file;
    const nombre = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nombre, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;   // ante la duda, va el original y el peso decide
  }
}
