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

  // TODAS las casillas son obligatorias, y se validan ACÁ además de en el
  // navegador: el atributo `required` del HTML se salta desde la consola en dos
  // líneas, y ya nos pasó — entró una cuenta de cobro SIN VALOR (#10, 18-ago) y
  // nadie se enteró hasta que Daniel la vio en la bandeja. Un cobro sin monto no
  // se puede programar ni pagar: es una solicitud muerta que ocupa una tarjeta.
  const OBLIGATORIOS: [string, string][] = [
    ["razon_social", "la razón social / nombre"],
    ["num_doc", "el número de documento"],
    ["contacto", "el nombre de contacto"],
    ["telefono", "el teléfono / WhatsApp"],
    ["correo", "el correo electrónico"],
    ["area", "el área con la que trataste"],
    ["valor", "el valor a cobrar"],
    ["concepto", "el concepto"],
    ["descripcion", "la descripción / detalle"],
  ];
  const faltan = OBLIGATORIOS.filter(([k]) => !s(k)).map(([, etiqueta]) => etiqueta);
  if (faltan.length) {
    return { ok: false, error: "Falta " + (faltan.length === 1 ? faltan[0]
      : faltan.slice(0, -1).join(", ") + " y " + faltan[faltan.length - 1]) + "." };
  }
  const razon = s("razon_social");
  const numDoc = s("num_doc");

  // El área llega de un <select> cerrado, pero el servidor no se fía del cliente:
  // lo que no esté en la lista se rechaza en vez de entrar como texto libre.
  const areaRaw = s("area").toUpperCase();
  if (!(AREAS as readonly string[]).includes(areaRaw)) {
    return { ok: false, error: "Elige un área de la lista." };
  }
  const area = areaRaw;

  // Sin monto no hay nada que programar; un 0 tampoco es un cobro.
  const valor = Number(s("valor").replace(/[^\d]/g, ""));
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, error: "El valor a cobrar tiene que ser un número mayor que cero." };
  }

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
