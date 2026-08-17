"use server";

// Recepción PÚBLICA de una cuenta de cobro (proveedor no-DIAN). Sube los documentos
// a Drive (vía el relay de la VM) y registra el envío en `cuentas_cobro` (estado
// 'recibida'). Sin login: esta ruta está fuera del middleware. Contabilidad la
// revisa en la bandeja.
import { subirDocumentos, avisoDocs, archivosDelForm, registrarCertificacion, etiquetaEnvio } from "@/lib/intake";
import { AREAS, CLASES_DOC, PLAZO_CUENTA_COBRO_DIAS } from "@/lib/areas";
import { getPool } from "@/lib/db";

export type Resultado = { ok: boolean; error?: string; aviso?: string };

export async function enviarCuentaCobro(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const razon = s("razon_social");
  const numDoc = s("num_doc");
  if (!razon) return { ok: false, error: "Falta la razón social / nombre." };
  if (!numDoc) return { ok: false, error: "Falta el número de documento." };

  // El área llega de un <select> cerrado, pero el servidor no se fía del cliente:
  // lo que no esté en la lista entra como vacío, no como texto libre.
  const areaRaw = s("area").toUpperCase();
  const area = (AREAS as readonly string[]).includes(areaRaw) ? areaRaw : null;

  const valorRaw = s("valor").replace(/[^\d]/g, "");
  const valor = valorRaw ? Number(valorRaw) : null;

  // Subir documentos a Drive (vía la VM). Quedan en CONTABILIDAD/Intake, privados.
  // Su falla NO tumba el envío: el proveedor ya llenó el formulario.
  const { docs, fallidos } = await subirDocumentos(
    archivosDelForm(formData, CLASES_DOC), "cuentas-de-cobro",
    { nit: numDoc, razon, envio: etiquetaEnvio() });

  // banco/tipo_cuenta/num_cuenta ya NO se piden: la cuenta sale de la
  // certificación bancaria que lee el sistema (columnas se dejan por historia).
  // El plazo es política de la casa: 30 días contados desde que llega.
  try {
    const pool = getPool();
    const r = await pool.query<{ id: number }>(
      `INSERT INTO cuentas_cobro
         (razon_social, tipo_doc, num_doc, contacto, correo, telefono,
          area, concepto, descripcion, valor, documentos, fecha_pago_prog)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               (now() AT TIME ZONE 'America/Bogota')::date + $12::int)
       RETURNING id`,
      [razon, s("tipo_doc") || "NIT", numDoc, s("contacto") || null, s("correo") || null,
       s("telefono") || null, area, s("concepto") || null, s("descripcion") || null,
       valor, JSON.stringify(docs), PLAZO_CUENTA_COBRO_DIAS]);
    await registrarCertificacion(pool, "cuenta_cobro", r.rows[0].id, numDoc, docs);
  } catch (e) {
    return { ok: false, error: "No se pudo registrar el envío: " + (e as Error).message };
  }
  return { ok: true, aviso: avisoDocs(fallidos) };
}
