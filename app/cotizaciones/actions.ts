"use server";

// Recepción PÚBLICA de una cotización. Sube documentos a Drive (vía el relay de la
// VM) y registra en `cotizaciones` (estado 'recibida') con un código COT-####.
// Luego se le hacen abonos y se cruza con la factura final para no pagar doble.
import { subirDocumentos, avisoDocs, archivosDelForm, registrarCertificacion, etiquetaEnvio } from "@/lib/intake";
import { AREAS, CLASES_DOC } from "@/lib/areas";
import { revisarArchivos } from "@/lib/documentos";
import { getPool } from "@/lib/db";

export type Resultado = { ok: boolean; error?: string; codigo?: string; aviso?: string };

export async function enviarCotizacion(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  // Todas obligatorias, validadas también en el servidor: el `required` del
  // HTML se salta desde la consola (ver el comentario en cuentas-de-cobro).
  const OBLIGATORIOS: [string, string][] = [
    ["razon_social", "la razón social / nombre"],
    ["nit", "el NIT"],
    ["contacto", "el nombre de contacto"],
    ["telefono", "el teléfono / WhatsApp"],
    ["correo", "el correo electrónico"],
    ["numero_cotizacion", "el número de tu cotización"],
    ["area", "el área con la que trataste"],
    ["valor", "el valor cotizado"],
    ["concepto", "el concepto"],
    ["descripcion", "la descripción / detalle"],
  ];
  const faltan = OBLIGATORIOS.filter(([k]) => !s(k)).map(([, etiqueta]) => etiqueta);
  if (faltan.length) {
    return { ok: false, error: "Falta " + (faltan.length === 1 ? faltan[0]
      : faltan.slice(0, -1).join(", ") + " y " + faltan[faltan.length - 1]) + "." };
  }
  const razon = s("razon_social");
  const nit = s("nit");

  const areaRaw = s("area").toUpperCase();
  if (!(AREAS as readonly string[]).includes(areaRaw)) {
    return { ok: false, error: "Elige un área de la lista." };
  }
  const area = areaRaw;

  const valor = Number(s("valor").replace(/[^\d]/g, ""));
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, error: "El valor cotizado tiene que ser un número mayor que cero." };
  }

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
  // Mismo filtro que en cuentas de cobro: el archivo malo no entra (ver
  // lib/documentos.ts). El navegador ya avisó; esto es lo que manda.
  const archivos = archivosDelForm(formData, CLASES_DOC);
  const problemas = await revisarArchivos(archivos, CLASES_DOC);
  if (problemas.length) return { ok: false, error: problemas.join(" · ") };

  const { docs, fallidos } = await subirDocumentos(
    archivos, "cotizaciones",
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
