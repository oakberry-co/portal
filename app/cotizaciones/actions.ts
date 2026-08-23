"use server";

// Recepción PÚBLICA de una cotización. Sube documentos a Drive (vía el relay de la
// VM) y registra en `cotizaciones` (estado 'recibida') con un código COT-####.
// Luego se le hacen abonos y se cruza con la factura final para no pagar doble.
import { subirDocumentos, avisoDocs, archivosDelForm, registrarCertificacion, registrarSoporte, etiquetaEnvio } from "@/lib/intake";
import { AREAS, CLASES_DOC, DOCS_COTIZACION } from "@/lib/areas";
import { revisarArchivos } from "@/lib/documentos";
import { getPool } from "@/lib/db";
import { nitCanonico, digitoVerificacion, soloDigitos } from "@/lib/nit";
import { pesos } from "@/lib/pesos";
import { reconocer, datosDe } from "@/lib/proveedor-conocido";

export type Resultado = { ok: boolean; error?: string; codigo?: string; aviso?: string };
export type { Reconocido } from "@/lib/proveedor-conocido";

/** Envoltura de servidor: el formulario (cliente) solo puede llamar acciones.
 *  La consulta vive en lib/proveedor-conocido.ts, compartida con cuentas de
 *  cobro — dos copias de la misma consulta es como se rompió el candado de
 *  aprobación el 19-ago. */
export async function reconocerProveedor(numDoc: string) {
  return reconocer(numDoc);
}

export async function enviarCotizacion(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  // Todas obligatorias, validadas también en el servidor: el `required` del
  // HTML se salta desde la consola (ver el comentario en cuentas-de-cobro).
  // PROVEEDOR RECURRENTE: ya nos cotizó o nos cobró antes, su cuenta está
  // certificada en el maestro y confirmada por un humano. No repite razón
  // social, contacto ni teléfono — eso lo hereda del último envío.
  const recurrente = s("recurrente") === "1";
  const OBLIGATORIOS: [string, string][] = recurrente ? [
    ["nit", "el NIT"],
    ["correo", "el correo electrónico"],
    ["numero_cotizacion", "el número de tu cotización"],
    ["area", "el área con la que trataste"],
    ["valor", "el valor cotizado"],
    ["concepto", "el concepto"],
    ["descripcion", "la descripción / detalle"],
  ] : [
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
  // Mismo cuidado que en cuentas de cobro: el NIT con dígito de verificación
  // pegado deja la cotización sin cruzar con su proveedor (ver lib/nit.ts).
  const nit = nitCanonico(s("nit"));
  // EL DÍGITO DE VERIFICACIÓN COMO SUMA DE CONTROL. Se comprueba también acá y
  // no solo en el navegador: el `required` y el aviso del formulario se saltan
  // desde la consola, y un NIT torcido no cruza con las facturas del proveedor
  // ni con su cuenta — la fila desaparece del archivo del banco sin dar error.
  //
  // Al RECURRENTE no se le pide: su NIT no lo está tecleando ahora, salió de
  // buscarlo en nuestra propia base. Pedírselo sería trancar a quien ya
  // reconocimos por un dato que nosotros mismos le dimos.
  if (!recurrente) {
    // Un NIT de empresa tiene NUEVE dígitos. Esta regla sola habría cazado el
    // '800165' de COT-0034, que el dígito de verificación NO cazó: por
    // casualidad daba el mismo (1 en 11). Por eso van las dos.
    const nitBase = soloDigitos(nit);
    if (nitBase.length !== 9) {
      return { ok: false, error: `Un NIT tiene 9 dígitos y llegaron ${nitBase.length}. `
        + "Míralo en tu RUT y escríbelo sin el dígito que va después del guion." };
    }
    const dv = soloDigitos(s("dv")).slice(0, 1);
    if (!dv) return { ok: false, error: "Falta el dígito de verificación del NIT (va después del guion en tu RUT)." };
    if (digitoVerificacion(nit) !== dv) {
      return { ok: false, error: `El NIT ${nit} y el dígito ${dv} no cuadran. Revísalos en tu RUT: `
        + "el NIT va antes del guion y el dígito después." };
    }
  }
  let razon = s("razon_social");
  let contacto = s("contacto") || null;
  let telefono = s("telefono") || null;

  // RECURRENTE: se vuelve a comprobar CONTRA LA BASE. Que el navegador mande
  // recurrente=1 no significa nada — si el NIT no tiene cuenta en el maestro,
  // este envío entraría sin documentos de identidad y sin a dónde pagarle.
  if (recurrente) {
    const p = await datosDe(nit);
    if (!p) {
      return { ok: false, error: "No encontramos ese NIT entre nuestros proveedores. "
        + "Envíala como proveedor nuevo, adjuntando tus documentos." };
    }
    razon = p.razon_social;
    contacto = contacto || p.contacto;
    telefono = telefono || p.telefono;
  }

  const areaRaw = s("area").toUpperCase();
  if (!(AREAS as readonly string[]).includes(areaRaw)) {
    return { ok: false, error: "Elige un área de la lista." };
  }
  const area = areaRaw;

  // SE INTERPRETA, NO SE LIMPIA. Borrar puntos y comas es lo que convirtió
  // '149.340,24' en 14.934.024 (COT-0026). `pesos()` lee la plata como se
  // escribe en Colombia — y como se escribe a la gringa, que también llega.
  const valor = Math.round(pesos(s("valor")) ?? NaN);
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
  // `CLASES_DOC` acá es el mapa de FORMATOS (qué archivo se acepta en cada
  // casilla), no la lista de obligatorios: esa es DOCS_COTIZACION, que no lleva
  // cédula. Si el navegador manda una de todos modos, se valida igual.
  const archivos = archivosDelForm(formData, CLASES_DOC);
  const problemas = await revisarArchivos(archivos, CLASES_DOC);
  if (problemas.length) return { ok: false, error: problemas.join(" · ") };
  // Lo único propio de ESTE envío. Sin soporte no hay qué cotizar, y sin
  // certificación (cuando es nuevo) no sabríamos a qué cuenta pagar el anticipo.
  const exigidos = recurrente ? ["soporte"] : DOCS_COTIZACION.map((c) => c.clase);
  const faltanDocs = exigidos.filter((clase) => !archivos.some((a) => a.clase === clase));
  if (faltanDocs.length) {
    const nombres = DOCS_COTIZACION.filter((c) => faltanDocs.includes(c.clase)).map((c) => c.label);
    return { ok: false, error: "Falta adjuntar: " + nombres.join(", ") + "." };
  }

  const { docs, fallidos } = await subirDocumentos(
    archivos, "cotizaciones",
    { nit, razon, envio: etiquetaEnvio() });

  try {
    const pool = getPool();
    const r = await pool.query<{ id: number }>(
      `INSERT INTO cotizaciones
         (razon_social, nit, contacto, correo, telefono, area, concepto, descripcion,
          valor, documentos, numero_cotizacion, requiere_adelanto, adelanto_pct, plazo_dias,
          recurrente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14) RETURNING id`,
      [razon, nit, contacto, s("correo") || null, telefono,
       area, s("concepto") || null, s("descripcion") || null, valor, JSON.stringify(docs),
       s("numero_cotizacion") || null, adelantoPct, plazoDias, recurrente]);
    const id = r.rows[0].id;
    const codigo = "COT-" + String(id).padStart(4, "0");
    await pool.query("UPDATE cotizaciones SET codigo = $2 WHERE id = $1", [id, codigo]);
    await registrarCertificacion(pool, "cotizacion", id, nit, docs);
    // Y el soporte, para cotejar que el monto que tecleó esté en su documento.
    await registrarSoporte(pool, "cotizacion", id, valor, docs);
    return { ok: true, codigo, aviso: avisoDocs(fallidos) };
  } catch (e) {
    return { ok: false, error: "No se pudo registrar la cotización: " + (e as Error).message };
  }
}
