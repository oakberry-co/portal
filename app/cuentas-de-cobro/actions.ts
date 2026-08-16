"use server";

// Recepción PÚBLICA de una cuenta de cobro (proveedor no-DIAN). Sube los documentos
// a Drive (vía el relay de la VM) y registra el envío en `cuentas_cobro` (estado
// 'recibida'). Sin login: esta ruta está fuera del middleware. Contabilidad la
// revisa en la bandeja.
import { subirDocumentos, avisoDocs } from "@/lib/intake";
import { getPool } from "@/lib/db";

export type Resultado = { ok: boolean; error?: string; aviso?: string };

export async function enviarCuentaCobro(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const razon = s("razon_social");
  const numDoc = s("num_doc");
  if (!razon) return { ok: false, error: "Falta la razón social / nombre." };
  if (!numDoc) return { ok: false, error: "Falta el número de documento." };

  const valorRaw = s("valor").replace(/[^\d]/g, "");
  const valor = valorRaw ? Number(valorRaw) : null;

  // Subir documentos a Drive (vía la VM). Quedan en CONTABILIDAD/Intake, privados.
  // Su falla NO tumba el envío: el proveedor ya llenó el formulario.
  const files = formData.getAll("documentos").filter((f): f is File => f instanceof File && f.size > 0);
  const { docs, fallidos } = await subirDocumentos(files.slice(0, 12), "cuentas-de-cobro");

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
  return { ok: true, aviso: avisoDocs(fallidos) };
}
