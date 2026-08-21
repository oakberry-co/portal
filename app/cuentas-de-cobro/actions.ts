"use server";

// Recepción PÚBLICA de una cuenta de cobro (proveedor no-DIAN). Sube los documentos
// a Drive (vía el relay de la VM) y registra el envío en `cuentas_cobro` (estado
// 'recibida'). Sin login: esta ruta está fuera del middleware. Contabilidad la
// revisa en la bandeja.
import { avisoDocs, registrarCertificacion, registrarSoporte } from "@/lib/intake";
import { docsDelLote } from "@/lib/intake-subida";
import { AREAS, CLASES_DOC, PLAZO_CUENTA_COBRO_DIAS } from "@/lib/areas";
import { getPool } from "@/lib/db";
import { nitCanonico } from "@/lib/nit";
import { reconocer, datosDe } from "@/lib/proveedor-conocido";

export type Resultado = { ok: boolean; error?: string; aviso?: string };


/** ¿Ya le cobraste a Oakberry antes? — el camino corto.
 *
 *  A un proveedor que ya está registrado se le pedían otra vez los cuatro
 *  documentos (certificación, RUT, cédula, soporte) para cobrar lo mismo del mes
 *  pasado. Desde el celular, que es de donde llega la mayoría, eso son cuatro
 *  adjuntos y la mitad abandona.
 *
 *  SE RECONOCE por el número de documento, y lo único que habilita es SALTARSE
 *  los documentos de identidad: la cuenta a la que se paga sale del maestro, la
 *  misma de siempre. Por este camino NADIE puede cambiarla — quien quiera
 *  cambiar de cuenta entra como nuevo, con certificación, y pasa por el candado
 *  de cambio de cuenta.
 *
 *  Qué se devuelve: el nombre ABREVIADO y los 4 últimos de la cuenta. Suficiente
 *  para que la persona confirme que es ella; inútil para cualquier otra cosa.
 *  (Cualquiera puede probar números de documento acá — pero acertar uno no da
 *  acceso a nada ni desvía un peso: el pago sigue yendo a la cuenta de siempre.) */
export type { Reconocido } from "@/lib/proveedor-conocido";

/** Envoltura de servidor: el formulario (cliente) solo puede llamar acciones.
 *  La consulta vive en lib/proveedor-conocido.ts, compartida con cotizaciones —
 *  dos copias de la misma consulta es como se rompió el candado de aprobación. */
export async function reconocerProveedor(numDoc: string) {
  return reconocer(numDoc);
}

export async function enviarCuentaCobro(_prev: Resultado | null, formData: FormData): Promise<Resultado> {
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  // TODAS las casillas son obligatorias, y se validan ACÁ además de en el
  // navegador: el atributo `required` del HTML se salta desde la consola en dos
  // líneas, y ya nos pasó — entró una cuenta de cobro SIN VALOR (#10, 18-ago) y
  // nadie se enteró hasta que Daniel la vio en la bandeja. Un cobro sin monto no
  // se puede programar ni pagar: es una solicitud muerta que ocupa una tarjeta.
  // El proveedor recurrente hereda sus datos del último envío (ver más abajo):
  // lo único que tiene que traer es lo de ESTE cobro.
  const recurrente = s("recurrente") === "1";
  const OBLIGATORIOS: [string, string][] = recurrente ? [
    ["num_doc", "el número de documento"],
    ["correo", "el correo electrónico"],
    ["area", "el área con la que trataste"],
    ["valor", "el valor a cobrar"],
    ["concepto", "el concepto"],
    ["descripcion", "la descripción / detalle"],
  ] : [
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
  // El proveedor teclea su NIT como le sale: '901675059', '901.675.059-9'…
  // Si se guarda con el dígito de verificación, este envío no cruza con las
  // facturas del MISMO proveedor ni con su cuenta del maestro, y el pago se cae
  // del archivo del banco sin un solo error (ver lib/nit.ts).
  const numDoc = nitCanonico(s("num_doc"));
  let razon = s("razon_social");
  let contacto = s("contacto") || null;
  let telefono = s("telefono") || null;
  let tipoDoc = s("tipo_doc") || "NIT";

  // RECURRENTE: se vuelve a comprobar CONTRA LA BASE. Que el navegador mande
  // recurrente=1 no significa nada — si el NIT no tiene cuenta en el maestro,
  // este envío entraría sin documentos de identidad y sin a dónde pagarle.
  if (recurrente) {
    const r = await datosDe(numDoc);
    if (!r) {
      return { ok: false, error: "No encontramos ese número de documento entre nuestros proveedores. "
        + "Envíalo como proveedor nuevo, adjuntando tus documentos." };
    }
    razon = r.razon_social;
    contacto = contacto || r.contacto;
    telefono = telefono || r.telefono;
    tipoDoc = r.tipo_doc || tipoDoc;
  }

  // El área llega de un <select> cerrado, pero el servidor no se fía del cliente:
  // lo que no esté en la lista se rechaza en vez de entrar como texto libre.
  const areaRaw = s("area").toUpperCase();
  if (!(AREAS as readonly string[]).includes(areaRaw)) {
    return { ok: false, error: "Elige un área de la lista." };
  }
  const area = areaRaw;

  // CONCEPTO: viene de una lista cerrada (el maestro) porque de él cuelga la
  // retención. Se valida CONTRA LA BASE — si el navegador manda algo que no está
  // en el maestro, no entra como concepto: entraría a ensuciar justo la columna
  // sobre la que se aprenden las tarifas.
  let concepto = s("concepto");
  if (concepto === "__otro") {
    concepto = s("concepto_otro");
    if (!concepto) return { ok: false, error: "Escribe cómo llamarías el concepto." };
  } else if (concepto) {
    try {
      const r = await getPool().query(
        "SELECT 1 FROM maestro_conceptos WHERE activo AND nombre = $1", [concepto]);
      if (!r.rowCount) {
        const libre = s("concepto_otro");
        if (!libre) return { ok: false, error: "Elige un concepto de la lista." };
        concepto = libre;
      }
    } catch { /* base caída: se acepta lo que venga, no se bloquea el cobro */ }
  }

  // Sin monto no hay nada que programar; un 0 tampoco es un cobro.
  const valor = Number(s("valor").replace(/[^\d]/g, ""));
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, error: "El valor a cobrar tiene que ser un número mayor que cero." };
  }

  // LOS DOCUMENTOS YA ESTÁN ARRIBA: subieron de a uno (lib/intake-subida.ts),
  // cada uno en su propia petición, porque los cuatro juntos chocaban contra el
  // tope de 4,5 MB de Vercel y el envío moría en el borde sin dejar error.
  //
  // Se leen de la base por el `lote` —un secreto del servidor— y no del
  // formulario: el intake es PÚBLICO, y si el navegador mandara los links de
  // Drive cualquiera podría inventarse documentos que no existen. La revisión
  // del archivo (formato, peso, PDF con clave) ya la hizo el servidor al subirlo.
  const docs = await docsDelLote(String(formData.get("lote") ?? "").trim());
  const fallidos = docs.filter((d) => d.estado === "pendiente").length;
  if (recurrente && !docs.some((d) => d.clase === "soporte")) {
    return { ok: false, error: "Falta el documento soporte (tu cuenta de cobro o factura de este servicio)." };
  }

  // banco/tipo_cuenta/num_cuenta ya NO se piden: la cuenta sale de la
  // certificación bancaria que lee el sistema (columnas se dejan por historia).
  // El plazo es política de la casa: 30 días contados desde que llega.
  try {
    const pool = getPool();
    const r = await pool.query<{ id: number }>(
      `INSERT INTO cuentas_cobro
         (razon_social, tipo_doc, num_doc, contacto, correo, telefono,
          area, concepto, descripcion, valor, documentos, recurrente, fecha_pago_prog)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
               (now() AT TIME ZONE 'America/Bogota')::date + $13::int)
       RETURNING id`,
      [razon, tipoDoc, numDoc, contacto, s("correo") || null,
       telefono, area, concepto || null, s("descripcion") || null,
       valor, JSON.stringify(docs), recurrente, PLAZO_CUENTA_COBRO_DIAS]);
    await registrarCertificacion(pool, "cuenta_cobro", r.rows[0].id, numDoc, docs);
    await registrarSoporte(pool, "cuenta_cobro", r.rows[0].id, valor, docs);
  } catch (e) {
    return { ok: false, error: "No se pudo registrar el envío: " + (e as Error).message };
  }
  return { ok: true, aviso: avisoDocs(fallidos) };
}

/** Como reconocerProveedor pero para uso interno del servidor: devuelve los datos
 *  completos (sin enmascarar) que hereda el envío recurrente. Nunca sale al
 *  navegador. */
