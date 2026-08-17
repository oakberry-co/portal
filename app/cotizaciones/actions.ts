"use server";

// Recepción PÚBLICA de una cotización. Sube documentos a Drive (vía el relay de la
// VM) y registra en `cotizaciones` (estado 'recibida') con un código COT-####.
// Luego se le hacen abonos y se cruza con la factura final para no pagar doble.
import { subirDocumentos, avisoDocs, archivosDelForm, registrarCertificacion, etiquetaEnvio } from "@/lib/intake";
import { AREAS, CLASES_DOC } from "@/lib/areas";
import { getPool } from "@/lib/db";

export type Resultado = { ok: boolean; error?: string; codigo?: string; aviso?: string };

export async function enviarCotizacion(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const razon = s("razon_social");
  const nit = s("nit");
  if (!razon) return { ok: false, error: "Falta la razón social / nombre." };
  if (!nit) return { ok: false, error: "Falta el NIT." };

  // El área llega de un <select> cerrado, pero el servidor no se fía del cliente:
  // lo que no esté en la lista entra como vacío, no como texto libre.
  const areaRaw = s("area").toUpperCase();
  const area = (AREAS as readonly string[]).includes(areaRaw) ? areaRaw : null;

  const valorRaw = s("valor").replace(/[^\d]/g, "");
  const valor = valorRaw ? Number(valorRaw) : null;

  // Adelanto OBLIGATORIO: este formulario existe solo para cotizaciones con
  // anticipo. Se topa a 1-100 — un "500%" mal escrito sería un compromiso de
  // pago inventado.
  const adelantoPct = Number(s("adelanto_pct").replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(adelantoPct) || adelantoPct <= 0 || adelantoPct > 100) {
    return { ok: false, error: "El porcentaje de adelanto debe estar entre 1 y 100." };
  }
  const plazo = Number(s("plazo_dias").replace(/[^\d]/g, ""));
  const plazoDias = Number.isFinite(plazo) && plazo >= 0 && plazo <= 180 ? plazo : null;

  // Los documentos van a Drive, pero su falla NO tumba el envío: la cotización
  // se registra igual y lo que no subió queda marcado 'pendiente'.
  const { docs, fallidos } = await subirDocumentos(
    archivosDelForm(formData, CLASES_DOC), "cotizaciones",
    { nit, razon, envio: etiquetaEnvio() });

  try {
    const pool = getPool();
    const r = await pool.query<{ id: number }>(
      `INSERT INTO cotizaciones
         (razon_social, nit, contacto, correo, telefono, area, concepto, descripcion,
          valor, documentos, numero_cotizacion, requiere_adelanto, adelanto_pct, plazo_dias)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13) RETURNING id`,
      [razon, nit, s("contacto") || null, s("correo") || null, s("telefono") || null,
       area, s("concepto") || null, s("descripcion") || null, valor, JSON.stringify(docs),
       s("numero_cotizacion") || null, adelantoPct, plazoDias]);
    const id = r.rows[0].id;
    const codigo = "COT-" + String(id).padStart(4, "0");
    await pool.query("UPDATE cotizaciones SET codigo = $2 WHERE id = $1", [id, codigo]);
    await registrarCertificacion(pool, "cotizacion", id, nit, docs);
    return { ok: true, codigo, aviso: avisoDocs(fallidos) };
  } catch (e) {
    return { ok: false, error: "No se pudo registrar la cotización: " + (e as Error).message };
  }
}
