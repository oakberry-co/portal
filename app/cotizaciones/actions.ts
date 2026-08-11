"use server";

// Recepción PÚBLICA de una cotización. Sube documentos a Vercel Blob y registra en
// `cotizaciones` (estado 'recibida') con un código COT-####. Luego se le hacen
// abonos y se cruza con la factura final para no pagar doble.
import { put } from "@vercel/blob";
import { getPool } from "@/lib/db";

export type Resultado = { ok: boolean; error?: string; codigo?: string };

export async function enviarCotizacion(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const razon = s("razon_social");
  const nit = s("nit");
  if (!razon) return { ok: false, error: "Falta la razón social / nombre." };
  if (!nit) return { ok: false, error: "Falta el NIT." };

  const valorRaw = s("valor").replace(/[^\d]/g, "");
  const valor = valorRaw ? Number(valorRaw) : null;

  const files = formData.getAll("documentos").filter((f): f is File => f instanceof File && f.size > 0);
  const docs: { nombre: string; path: string; tipo: string }[] = [];
  try {
    for (const f of files.slice(0, 12)) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "documento";
      const blob = await put(`cotizaciones/${safe}`, f, { access: "public", addRandomSuffix: true });
      docs.push({ nombre: f.name, path: blob.url, tipo: f.type });
    }
  } catch (e) {
    return { ok: false, error: "No se pudieron subir los documentos: " + (e as Error).message };
  }

  try {
    const pool = getPool();
    const r = await pool.query<{ id: number }>(
      `INSERT INTO cotizaciones
         (razon_social, nit, contacto, correo, telefono, area, concepto, descripcion, valor, documentos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [razon, nit, s("contacto") || null, s("correo") || null, s("telefono") || null,
       s("area") || null, s("concepto") || null, s("descripcion") || null, valor, JSON.stringify(docs)]);
    const id = r.rows[0].id;
    const codigo = "COT-" + String(id).padStart(4, "0");
    await pool.query("UPDATE cotizaciones SET codigo = $2 WHERE id = $1", [id, codigo]);
    return { ok: true, codigo };
  } catch (e) {
    return { ok: false, error: "No se pudo registrar la cotización: " + (e as Error).message };
  }
}
