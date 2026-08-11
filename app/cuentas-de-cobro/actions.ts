"use server";

// Recepción PÚBLICA de una cuenta de cobro (proveedor no-DIAN). Sube los documentos
// a Vercel Blob y registra el envío en `cuentas_cobro` (estado 'recibida'). Sin
// login: esta ruta está fuera del middleware. Contabilidad la revisa en la bandeja.
import { put } from "@vercel/blob";
import { getPool } from "@/lib/db";

export type Resultado = { ok: boolean; error?: string };

export async function enviarCuentaCobro(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const razon = s("razon_social");
  const numDoc = s("num_doc");
  if (!razon) return { ok: false, error: "Falta la razón social / nombre." };
  if (!numDoc) return { ok: false, error: "Falta el número de documento." };

  const valorRaw = s("valor").replace(/[^\d]/g, "");
  const valor = valorRaw ? Number(valorRaw) : null;

  // Subir documentos a Vercel Blob (link público con sufijo aleatorio = no adivinable).
  const files = formData.getAll("documentos").filter((f): f is File => f instanceof File && f.size > 0);
  const docs: { nombre: string; path: string; tipo: string }[] = [];
  try {
    for (const f of files.slice(0, 12)) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "documento";
      const blob = await put(`cuentas-cobro/${safe}`, f, { access: "public", addRandomSuffix: true });
      docs.push({ nombre: f.name, path: blob.url, tipo: f.type });
    }
  } catch (e) {
    return { ok: false, error: "No se pudieron subir los documentos: " + (e as Error).message };
  }

  try {
    await getPool().query(
      `INSERT INTO cuentas_cobro
         (razon_social, tipo_doc, num_doc, contacto, correo, telefono,
          area, concepto, descripcion, valor, banco, tipo_cuenta, num_cuenta, documentos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [razon, s("tipo_doc") || "NIT", numDoc, s("contacto") || null, s("correo") || null,
       s("telefono") || null, s("area") || null, s("concepto") || null, s("descripcion") || null,
       valor, s("banco") || null, s("tipo_cuenta") || null, s("num_cuenta") || null, JSON.stringify(docs)]);
  } catch (e) {
    return { ok: false, error: "No se pudo registrar el envío: " + (e as Error).message };
  }
  return { ok: true };
}
