"use server";

// Recepción PÚBLICA de una cuenta de cobro para la EMPRESA DE RD. Sin login (la
// ruta cuelga de /cuentas-de-cobro, que está fuera del middleware). Sube los
// documentos a Drive por el relay de la VM —carpeta propia de RD— y registra el
// envío en `rd_cuentas_cobro` como 'recibida'. Lo revisa el decisor en
// /contabilidad/rd/cuentas-de-cobro.
//
// TODO se valida acá aunque el navegador ya lo haya hecho: el `required` y el
// `accept` del HTML se saltan desde la consola en dos líneas (ya entró en
// Colombia una cuenta de cobro SIN VALOR, #10).

import { subirDocumentos, avisoDocs, archivosDelForm, etiquetaEnvio } from "@/lib/intake";
import { revisarArchivos } from "@/lib/documentos";
import { getPool } from "@/lib/db";
import { idCanonico, problemaId, verificaId, telefonoRD, revisarNcf, type TipoId } from "@/lib/rd/identidad";
import { BANCOS_RD, CLASES_DOC_RD, MONEDAS_RD, concepto as conceptoDe, mesesElegibles, montoRD, centavos, refRD } from "@/lib/rd/catalogo";

export type ResultadoRD = {
  ok: boolean; error?: string; aviso?: string; ref?: string;
  /** El dígito verificador no cuadró: el formulario muestra la casilla para
   *  confirmar (hay cédulas viejas válidas que no pasan el Luhn). */
  pedirConfirmarId?: boolean;
};

/** Topes de cordura. No son política: son el "¿seguro?" contra el cero de más
 *  tecleado con el pulgar. El presupuesto entero de mercadeo de RD es US$3.200
 *  al mes; un cobro por encima de esto casi seguro es un error de dedo, y quien
 *  de verdad cobre eso tiene la salida escrita en el mensaje. */
const TOPE = { DOP: 1_000_000, USD: 20_000 } as const;

export async function enviarCuentaCobroRD(_prev: ResultadoRD | null, fd: FormData): Promise<ResultadoRD> {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const no = (error: string): ResultadoRD => ({ ok: false, error });

  const tipoPersona = s("tipo_persona");
  if (tipoPersona !== "fisica" && tipoPersona !== "juridica") return no("Elige si cobras como persona física o como empresa.");

  const OBLIG: [string, string][] = [
    ["nombre", tipoPersona === "juridica" ? "la razón social" : "tu nombre completo"],
    ["num_id", "el número de identificación"], ["correo", "el correo"], ["telefono", "el teléfono / WhatsApp"],
    ["concepto", "el concepto"], ["descripcion", "la descripción"], ["periodo", "el mes del servicio"],
    ["valor", "el valor"], ["banco", "el banco"], ["tipo_cuenta", "el tipo de cuenta"],
    ["num_cuenta", "el número de cuenta"], ["titular_cuenta", "el titular de la cuenta"],
  ];
  const faltan = OBLIG.filter(([k]) => !s(k)).map(([, e]) => e);
  if (faltan.length) {
    return no("Falta " + (faltan.length === 1 ? faltan[0] : faltan.slice(0, -1).join(", ") + " y " + faltan[faltan.length - 1]) + ".");
  }

  // IDENTIFICACIÓN. Una empresa se identifica con RNC; una persona física con
  // cédula (o pasaporte si es extranjera). Canónico = solo dígitos: '001-1391820-5'
  // y '00113918205' tienen que ser la MISMA persona para la base.
  const tipoId = s("tipo_id") as TipoId;
  if (!["cedula", "rnc", "pasaporte"].includes(tipoId)) return no("Elige el tipo de identificación.");
  if (tipoPersona === "juridica" && tipoId !== "rnc") return no("Una empresa se identifica con su RNC.");
  const numId = idCanonico(tipoId, s("num_id"));
  const mal = problemaId(tipoId, numId);
  if (mal) return no(mal);
  const verifica = verificaId(tipoId, numId);
  if (!verifica && s("confirmo_id") !== "1") {
    return { ok: false, pedirConfirmarId: true,
             error: `El número ${numId} no pasa la verificación de la ${tipoId === "rnc" ? "DGII" : "JCE"}. `
                  + "Revísalo contra tu documento. Si está bien escrito, marca la casilla de confirmación y envía de nuevo." };
  }

  const correo = s("correo");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return no("El correo no parece completo (nombre@dominio.com).");
  const telefono = telefonoRD(s("telefono"));
  if (!telefono) return no("El teléfono tiene que ser de República Dominicana: 10 dígitos que empiezan por 809, 829 o 849.");
  const ig = s("instagram").replace(/^@+/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, 40) || null;

  // CONCEPTO de la lista cerrada de RD; el 'otro' trae su nombre aparte.
  const c = conceptoDe(s("concepto"));
  if (!c) return no("Elige un concepto de la lista.");
  const conceptoOtro = c.id === "otro" ? s("concepto_otro") : null;
  if (c.id === "otro" && !conceptoOtro) return no("Escribe qué servicio es.");

  const periodo = s("periodo");
  if (!mesesElegibles().includes(periodo)) {
    return no("El mes del servicio tiene que ser este o uno de los dos anteriores. Si es más viejo, escríbenos por WhatsApp.");
  }

  // EVIDENCIA. Para lo que se publica o se entrega como contenido, el enlace es
  // la prueba de que el servicio existió — y lo que el aprobador abre primero.
  const enlaces = s("enlaces").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const malos = enlaces.filter((u) => !/^https?:\/\/[^\s]+\.[^\s]+/i.test(u));
  if (malos.length) return no(`Este enlace no parece una dirección web completa: ${malos[0]} (tiene que empezar por https://).`);
  if (c.evidencia && !enlaces.length) return no("Pega el enlace de lo que publicaste o entregaste (post, reel, carpeta de Drive…).");
  if (enlaces.length > 10) return no("Máximo 10 enlaces. Si son más, ponlos en una carpeta y comparte el enlace de la carpeta.");

  // LA PLATA. Se INTERPRETA, no se limpia: borrar puntos y comas es lo que
  // convirtió 149.340,24 en 14.934.024 (COT-0026).
  const moneda = s("moneda");
  if (!(MONEDAS_RD as readonly string[]).includes(moneda)) return no("Elige la moneda: pesos dominicanos o dólares.");
  const valor = centavos(montoRD(s("valor")) ?? NaN);
  if (!Number.isFinite(valor) || valor <= 0) return no("El valor tiene que ser un número mayor que cero.");
  if (valor > TOPE[moneda as "DOP" | "USD"]) {
    return no(`El valor (${moneda} ${valor.toLocaleString("es-DO")}) es más alto de lo normal para este formulario. `
            + "Revisa que no sobre un cero; si de verdad es ese monto, escríbenos por WhatsApp antes de enviarlo.");
  }

  // NCF. Con NCF propio, la factura es suya (y puede traer ITBIS). Sin NCF, la
  // empresa le emite un B11 y no hay ITBIS que cobrar. Una empresa SIEMPRE
  // factura con NCF.
  const tieneNcf = s("tiene_ncf") === "si";
  if (tipoPersona === "juridica" && !tieneNcf) return no("Una empresa tiene que facturar con NCF. Escribe el NCF de tu factura.");
  let ncf: string | null = null;
  let fechaNcf: string | null = null;
  let itbis = 0;
  let aviso: string | undefined;
  if (tieneNcf) {
    const r = revisarNcf(s("ncf"));
    if (r.error) return no(r.error);
    if (!r.ncf) return no("Escribe el NCF de tu factura.");
    ncf = r.ncf;
    aviso = r.aviso;
    // La fecha de SU factura es la «fecha comprobante» del 606: sin ella el
    // contador tendría que abrir cada PDF para armar el reporte.
    fechaNcf = s("fecha_ncf");
    const hoyRD = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNcf)) return no("Escribe la fecha de tu factura.");
    if (fechaNcf > hoyRD) return no("La fecha de la factura no puede ser futura.");
    if (fechaNcf < "2025-01-01") return no("La fecha de la factura es muy vieja para este formulario: escríbenos por WhatsApp.");
    const it = s("itbis_facturado") ? montoRD(s("itbis_facturado")) : 0;
    itbis = centavos(it ?? NaN);
    if (!Number.isFinite(itbis) || itbis < 0) return no("El ITBIS tiene que ser un número (o déjalo vacío si tu factura no lleva ITBIS).");
    if (itbis > valor * 0.18 + 0.01) {
      return no("El ITBIS es más del 18 % del valor. Escribe en «Valor» el monto SIN ITBIS y el ITBIS aparte, como en tu factura.");
    }
  }

  // LA CUENTA. Lista cerrada de bancos (con salida "Otro"), número como TEXTO:
  // los ceros a la izquierda son parte de la cuenta y un número los borra.
  let banco = s("banco");
  if (banco === "__otro") {
    const otro = s("banco_otro");
    if (!otro) return no("Escribe el nombre de tu banco.");
    banco = "Otro: " + otro.slice(0, 60);
  } else if (!(BANCOS_RD as readonly string[]).includes(banco)) {
    return no("Elige tu banco de la lista.");
  }
  const tipoCuenta = s("tipo_cuenta");
  if (tipoCuenta !== "ahorros" && tipoCuenta !== "corriente") return no("Elige si la cuenta es de ahorros o corriente.");
  const numCuenta = s("num_cuenta").replace(/[\s-]/g, "");
  if (!/^\d{5,20}$/.test(numCuenta)) return no("El número de cuenta lleva solo dígitos (entre 5 y 20), sin letras.");

  // DOCUMENTOS. El soporte siempre; cédula y comprobante de cuenta, la primera
  // vez (quien ya cobró con LA MISMA cuenta los hereda: lo decide la bandeja
  // contra los pagos anteriores, no lo que diga este formulario).
  const archivos = archivosDelForm(fd, CLASES_DOC_RD);
  const problemas = await revisarArchivos(archivos, CLASES_DOC_RD);
  if (problemas.length) return no(problemas.join(" · "));
  if (!archivos.some((a) => a.clase === "soporte")) return no("Falta tu cuenta de cobro o factura (el documento de este cobro).");

  const pool = getPool();
  // El duplicado se mira ANTES de subir a Drive: si es el mismo cobro, no tiene
  // sentido dejar otra carpeta de documentos huérfana. El índice único sigue
  // siendo la defensa de verdad (dos envíos simultáneos pasan este SELECT).
  const dup = await pool.query<{ id: number }>(
    `SELECT id FROM rd_cuentas_cobro
      WHERE num_id = $1 AND periodo = $2::date AND concepto = $3 AND moneda = $4 AND valor = $5
        AND estado <> 'rechazada' LIMIT 1`,
    [numId, periodo + "-01", c.id, moneda, valor]);
  if (dup.rowCount) {
    return no(`Ya recibimos este mismo cobro (${refRD(dup.rows[0].id)}). Si es un servicio distinto del mismo mes, `
            + "júntalos en una sola cuenta de cobro con el valor total.");
  }

  const { docs, fallidos } = await subirDocumentos(archivos, "rd-cuentas-de-cobro",
    { nit: numId, razon: s("nombre"), envio: etiquetaEnvio() });

  try {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO rd_cuentas_cobro
         (tipo_persona, nombre, tipo_id, num_id, id_verifica, correo, telefono, instagram,
          concepto, concepto_otro, descripcion, periodo, enlaces, moneda, valor, itbis_facturado,
          ncf_proveedor, fecha_ncf, banco, tipo_cuenta, num_cuenta, titular_cuenta, documentos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13,$14,$15,$16,$17,$18::date,$19,$20,$21,$22,$23)
       RETURNING id`,
      [tipoPersona, s("nombre").slice(0, 160), tipoId, numId, verifica, correo, telefono, ig,
       c.id, conceptoOtro, s("descripcion").slice(0, 1000), periodo + "-01", enlaces, moneda, valor, itbis,
       ncf, fechaNcf, banco, tipoCuenta, numCuenta, s("titular_cuenta").slice(0, 160), JSON.stringify(docs)]);
    // En RD el contacto es por WhatsApp (línea RD), no por correo: el aviso de
    // Colombia diría "te los pediremos por correo" y nadie lo haría.
    const docsMal = fallidos ? (avisoDocs(fallidos) ?? "").replace("por correo", "por WhatsApp").replace("Contabilidad", "El equipo") : "";
    const avisos = [aviso, docsMal].filter(Boolean).join(" ");
    return { ok: true, ref: refRD(r.rows[0].id), aviso: avisos || undefined };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return no("Ya recibimos este mismo cobro hace un momento. Si es un servicio distinto, júntalos en una sola cuenta de cobro.");
    }
    return no("No se pudo registrar el envío: " + (e as Error).message);
  }
}
