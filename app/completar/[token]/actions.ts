"use server";

// Recibe SOLO documentos, contra un token. No toca el valor, ni la cuenta, ni el
// NIT: dejar editar eso sería el formulario público con los candados quitados.
import { subirDocumentos, avisoDocs, archivosDelForm, registrarCertificacion, etiquetaEnvio } from "@/lib/intake";
import { CLASES_DOC } from "@/lib/areas";
import { getPool } from "@/lib/db";
import { revalidatePath } from "next/cache";

export type Resultado = { ok: boolean; error?: string; aviso?: string };

export async function completarSolicitud(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const token = String(formData.get("token") ?? "").trim();
  if (token.length < 20) return { ok: false, error: "Enlace inválido." };

  const pool = getPool();
  const q = await pool.query<{
    tipo: "cuenta_cobro" | "cotizacion"; id: number; nit: string; razon: string;
    estado: string; documentos: { clase?: string }[];
  }>(
    `SELECT 'cuenta_cobro'::text AS tipo, id, num_doc AS nit, razon_social AS razon, estado, documentos
       FROM cuentas_cobro WHERE token = $1
     UNION ALL
     SELECT 'cotizacion', id, nit, razon_social, estado, documentos FROM cotizaciones WHERE token = $1`,
    [token]);
  const s = q.rows[0];
  if (!s) return { ok: false, error: "Enlace inválido o vencido." };
  if (s.estado === "pagada") return { ok: false, error: "Esta solicitud ya fue pagada." };

  const nuevos = archivosDelForm(formData, CLASES_DOC);
  if (!nuevos.length) return { ok: false, error: "Adjunta al menos un documento." };

  const { docs, fallidos } = await subirDocumentos(
    nuevos, s.tipo === "cuenta_cobro" ? "cuentas-de-cobro" : "cotizaciones",
    { nit: s.nit, razon: s.razon, envio: etiquetaEnvio() + " (completado)" });

  try {
    const tabla = s.tipo === "cuenta_cobro" ? "cuentas_cobro" : "cotizaciones";
    // Se REEMPLAZA el documento de esa clase y se conservan los demás: lo que ya
    // estaba bien no se vuelve a pedir ni se pierde.
    const clasesNuevas = new Set<string>(docs.map((d) => d.clase));
    const conservados = (s.documentos ?? []).filter((d) => !clasesNuevas.has(d.clase ?? ""));
    await pool.query(
      `UPDATE ${tabla}
          SET documentos = $2::jsonb,
              -- vuelve a la fila de revisión: si estaba rechazada, se reabre
              estado = CASE WHEN estado IN ('rechazada','recibida') THEN 'recibida' ELSE estado END,
              nota_revision = NULL
        WHERE id = $1`,
      [s.id, JSON.stringify([...conservados, ...docs])]);

    // Si volvió a mandar la certificación, se encola y se lee de una.
    if (docs.some((d) => d.clase === "certificacion_bancaria")) {
      await registrarCertificacion(pool, s.tipo, s.id, s.nit, docs);
    }
  } catch (e) {
    return { ok: false, error: "No se pudo guardar: " + (e as Error).message };
  }
  revalidatePath(s.tipo === "cuenta_cobro" ? "/contabilidad/cuentas-de-cobro" : "/contabilidad/cotizaciones");
  return { ok: true, aviso: avisoDocs(fallidos) };
}
