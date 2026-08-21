"use server";

// UN DOCUMENTO POR PETICIÓN — es lo que hace que quepan los pesados.
//
// El envío del intake viajaba entero en un request y Vercel corta en 4,5 MB,
// EN EL BORDE (413): la función ni se ejecutaba, así que no había error que
// mostrar y el proveedor veía "Se nos cayó la página" sin código. El tope era
// para TODO junto — tres PDF de 2 MB pasaban uno a uno y el envío se caía igual.
//
// Ahora cada documento sube solo, en su propia petición, y el tope pasa a ser
// POR DOCUMENTO. De paso el proveedor ve avanzar sus adjuntos en vez de mirar
// una barra congelada medio minuto.
//
// EL NAVEGADOR NO LLEVA LAS URL DE VUELTA, lleva un `lote`: un secreto aleatorio
// que genera el servidor. El intake es público — si el formulario mandara la
// lista de documentos ya subidos, cualquiera podría inventarse una con links que
// no existen. Con el lote, las URL las sigue produciendo el servidor.

import { randomBytes } from "crypto";
import { getPool } from "@/lib/db";
import { subirAintake, etiquetaEnvio, type DocIntake } from "@/lib/intake";
import { motivoRechazo, tieneClave, type Formatos } from "@/lib/documentos";
import { CLASES_DOC } from "@/lib/areas";
import { nitCanonico } from "@/lib/nit";

export type SubidaOk = {
  ok: true;
  /** Token del lote. El primer archivo lo crea; los demás lo reusan. */
  lote: string;
  /** Carpeta de Drive del envío. La fija el PRIMER archivo y la heredan los
   *  demás: si cada uno recalculara la etiqueta con la hora, un lote que cruce
   *  el cambio de minuto quedaría repartido en dos carpetas. */
  envio: string;
  clase: string;
  nombre: string;
  /** false = se registró, pero el archivo no llegó a Drive (Regla 18: el envío
   *  del proveedor no se pierde por una falla de infraestructura). */
  enDrive: boolean;
};
export type SubidaError = { ok: false; error: string };
export type Subida = SubidaOk | SubidaError;

/** Sube UN documento del intake. Público, como el formulario que lo llama. */
export async function subirUnDocumento(fd: FormData): Promise<Subida> {
  const file = fd.get("file");
  const clase = String(fd.get("clase") ?? "").trim();
  const carril = String(fd.get("carril") ?? "");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No llegó el archivo. Vuelve a adjuntarlo." };
  }
  // Lista CERRADA: `carril` decide la carpeta de Drive y `clase` el nombre. Que
  // el navegador mande cualquier cosa aquí sería dejarle elegir dónde escribe.
  if (carril !== "cuentas-de-cobro" && carril !== "cotizaciones") {
    return { ok: false, error: "Carril inválido." };
  }
  const def = CLASES_DOC.find((c) => c.clase === clase);
  if (!def) return { ok: false, error: "Documento no reconocido." };

  // LA MISMA revisión del formulario, acá, que es donde manda: el `accept` de un
  // <input> se salta arrastrando y el peso se puede falsear desde la consola.
  const formatos: Formatos = def.formatos;
  const malo = motivoRechazo(file, formatos, def.label)
    ?? ((await tieneClave(file))
        ? `${def.label}: este PDF tiene contraseña y así no lo podemos abrir.`
        : null);
  if (malo) return { ok: false, error: malo };

  const lote = String(fd.get("lote") ?? "").trim() || randomBytes(24).toString("hex");
  const envio = String(fd.get("envio") ?? "").trim() || etiquetaEnvio();
  const quien = {
    nit: nitCanonico(String(fd.get("nit") ?? "")),
    razon: String(fd.get("razon") ?? "").trim() || "sin razón social",
    envio,
  };

  let path = "";
  let error: string | null = null;
  try {
    const up = await subirAintake(file, carril, `${clase}__${file.name}`, quien);
    path = up.url;
  } catch (e) {
    // No tumba nada: se registra 'pendiente' y contabilidad se lo pide al
    // proveedor. Perder el envío entero por Drive sería peor.
    error = (e as Error).message.slice(0, 200);
    console.error("[intake] no se pudo subir '" + file.name + "':", e);
  }

  try {
    const pool = getPool();
    // Un mismo documento puede re-elegirse: gana el último de esa clase.
    await pool.query("DELETE FROM intake_subida WHERE lote = $1 AND clase = $2", [lote, clase]);
    await pool.query(
      `INSERT INTO intake_subida (lote, clase, nombre, path, tipo, estado, error, envio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [lote, clase, file.name, path, file.type, path ? "subido" : "pendiente", error, envio]);
  } catch (e) {
    return { ok: false, error: "No se pudo registrar el adjunto: " + (e as Error).message };
  }
  return { ok: true, lote, envio, clase, nombre: file.name, enDrive: Boolean(path) };
}

/** Los documentos de un lote, en el formato que guardan las solicitudes.
 *
 *  Los CONSUME: los borra en la misma llamada, para que un lote no se pueda
 *  reusar en dos solicitudes. Se llama dentro del try del envío, así que si el
 *  INSERT de la solicitud falla, el rollback... NO los devuelve (van por otra
 *  conexión): por eso se leen y borran solo cuando ya se va a guardar. */
export async function docsDelLote(lote: string): Promise<DocIntake[]> {
  if (!lote || lote.length < 20) return [];
  const pool = getPool();
  const { rows } = await pool.query<{
    clase: string; nombre: string; path: string; tipo: string | null;
    estado: string; error: string | null;
  }>(`DELETE FROM intake_subida WHERE lote = $1
      RETURNING clase, nombre, path, tipo, estado, error`, [lote]);
  return rows.map((r) => ({
    nombre: r.nombre, path: r.path, tipo: r.tipo ?? "", clase: r.clase,
    estado: r.estado === "subido" ? "subido" : "pendiente",
    ...(r.error ? { error: r.error } : {}),
  }));
}
