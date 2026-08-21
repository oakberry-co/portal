// FASE 1 DEL ENVÍO: los documentos suben de a uno, antes de mandar el formulario.
//
// Vive acá y no dentro de cada formulario porque son TRES los que lo hacen
// (cuentas de cobro, cotizaciones y /completar) y el día que uno se quede atrás
// vuelve el 413 solo en ese — que es la clase de bug que nadie encuentra.
//
// El navegador nunca ve las URL de Drive: solo lleva el `lote` (un secreto que
// genera el servidor) y al final manda ESE. Ver lib/intake-subida.ts.

"use client";

import { subirUnDocumento } from "@/lib/intake-subida";

export type Progreso = { hecho: number; total: number; actual: string };

export type ResultadoLote =
  | { ok: true; lote: string; sinDrive: number }
  | { ok: false; error: string };

/** Sube los archivos que trae el FormData, uno por petición, y los SACA de él.
 *
 *  Al terminar, `fd` ya no lleva archivos: lleva `lote`. Así el envío final es
 *  un request diminuto que no puede chocar contra el tope de Vercel por más
 *  documentos que haya adjuntado el proveedor.
 *
 *  Se sube en SERIE, no en paralelo: desde datos móviles, cuatro subidas a la
 *  vez se pelean el ancho de banda y el proveedor ve todo detenido a la vez.
 *  De a uno, ve avanzar. */
export async function subirLote(
  fd: FormData,
  carril: "cuentas-de-cobro" | "cotizaciones",
  campos: readonly { name: string; clase: string; label: string }[],
  onProgreso?: (p: Progreso) => void,
): Promise<ResultadoLote> {
  const porSubir = campos
    .map((c) => ({ c, f: fd.get(c.name) }))
    .filter((x): x is { c: typeof campos[number]; f: File } =>
      x.f instanceof File && x.f.size > 0);

  let lote = "";
  let envio = "";
  let sinDrive = 0;

  for (let i = 0; i < porSubir.length; i++) {
    const { c, f } = porSubir[i];
    onProgreso?.({ hecho: i, total: porSubir.length, actual: c.label });
    const uno = new FormData();
    uno.set("file", f, f.name);
    uno.set("clase", c.clase);
    uno.set("carril", carril);
    // El lote y la carpeta los fija el PRIMER archivo; el resto los hereda.
    if (lote) uno.set("lote", lote);
    if (envio) uno.set("envio", envio);
    // Para nombrar la carpeta de Drive con el proveedor, no con un número.
    uno.set("nit", String(fd.get("nit") ?? fd.get("num_doc") ?? ""));
    uno.set("razon", String(fd.get("razon_social") ?? ""));

    let r;
    try {
      r = await subirUnDocumento(uno);
    } catch {
      // Un fallo de RED en esta fase sí tumba el envío, y a propósito: acá
      // todavía no se ha registrado nada, así que reintentar es gratis. Lo que
      // no se puede perder es un envío YA guardado.
      return { ok: false, error: `No se pudo subir ${c.label}. Revisa tu conexión e inténtalo otra vez.` };
    }
    if (!r.ok) return { ok: false, error: r.error };
    lote = r.lote;
    envio = r.envio;
    if (!r.enDrive) sinDrive++;
    // El archivo ya está arriba: se saca del formulario para que el envío final
    // viaje sin él. Es TODO el punto de este módulo.
    fd.delete(c.name);
    onProgreso?.({ hecho: i + 1, total: porSubir.length, actual: c.label });
  }

  if (lote) fd.set("lote", lote);
  return { ok: true, lote, sinDrive };
}
