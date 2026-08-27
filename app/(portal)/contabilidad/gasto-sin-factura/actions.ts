"use server";

// CARGAR UN GASTO QUE NADIE NOS FACTURA (servicios públicos y otros).
//
// Hay plata que sale todos los meses y nunca llega como factura electrónica: el
// agua, la luz, el internet de una tienda, un impuesto, un reembolso. Hasta hoy
// esos gastos no tenían por dónde entrar al portal — se pagaban por fuera y no
// quedaban ni clasificados ni con soporte.
//
// Esto NO es un portal público: lo abre una persona del equipo (compras@) desde
// adentro, ya autenticada. Por eso no pide los 4 documentos del intake ni pasa
// por bandeja de aprobación: quien lo sube ya es de la casa. Lo que sí exige es
// el SOPORTE —el recibo— porque un pago sin respaldo es exactamente lo que este
// módulo existe para dejar de hacer.
//
// Una vez creado entra a Conciliación como un documento más "sin factura DIAN":
// se le pone concepto y destino, se le practican retenciones, y solo entonces
// aparece en Pagos.

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { registrarEvento } from "@/lib/eventos";
import { nitCanonico } from "@/lib/nit";
import { limpiarTextoHumano, limpiarCorreo } from "@/lib/texto";
import { subirDocumentos, etiquetaEnvio } from "@/lib/intake";
import { intentar, type Resultado } from "@/lib/resultado";
import { getPool } from "@/lib/db";
import { refDe } from "@/lib/documentos-no-dian";
import { crearPlantilla, generarPendientes, darDeBaja } from "@/lib/plantillas";
import { pesos } from "@/lib/pesos";
import { mesDe, mesSiguiente, hoyBogota } from "@/lib/habiles";
import { TIPOS_GASTO, FORMAS_PAGO, esFormaPago, vaAlBanco } from "@/lib/gastos-periodicos";

// Ojo al tocar este archivo: es `"use server"`, y de un módulo de servidor Next
// solo deja exportar funciones async. Las constantes (los tipos de gasto, las
// formas de pago) viven en `lib/gastos-periodicos.ts` — exportarlas desde acá
// compilaba sin queja y reventaba en el navegador con "h.map is not a function".

export async function crearGastoSinFactura(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("clasificar");

    const t = (k: string) => limpiarTextoHumano(String(fd.get(k) ?? ""));
    const tipo = String(fd.get("tipo") ?? "").trim();
    if (!TIPOS_GASTO.some((x) => x.valor === tipo)) throw new Error("Elige qué tipo de gasto es.");
    const detalle = t("tipo_detalle");
    // "Otro" sin decir cuál es una fila que dentro de un mes nadie sabe leer.
    if (tipo === "otro" && !detalle) throw new Error("Escribe qué gasto es (por ejemplo: impuesto predial BOG001).");

    const razon = t("razon_social");
    if (!razon) throw new Error("Falta a quién se le paga (la empresa de servicios, la entidad…).");
    // El NIT es la llave con la que después se le encuentra la cuenta bancaria:
    // si entra con el dígito de verificación pegado, el pago no sale del banco
    // y nadie ve el error (ver lib/nit.ts).
    const nit = nitCanonico(String(fd.get("num_doc") ?? ""));
    if (!nit) throw new Error("Falta el NIT o la cédula de quien cobra.");

    // El valor se lee como en Colombia: el punto separa MILES. "9.870" son nueve
    // mil ochocientos setenta, no nueve con ochenta y siete.
    const valor = Math.round(Number(String(fd.get("valor") ?? "").replace(/[^\d]/g, "")));
    if (!Number.isFinite(valor) || valor <= 0) throw new Error("Escribe el valor del gasto.");

    const fecha = String(fd.get("fecha_documento") ?? "").trim() || null;
    const soporte = fd.get("doc_soporte");
    if (!(soporte instanceof File) || soporte.size === 0) {
      throw new Error("Adjunta el documento soporte (el recibo o la factura del servicio).");
    }

    // La subida va ANTES de abrir la transacción: puede tardar, y no se bloquean
    // filas mientras tanto. Si Drive falla NO se pierde el registro — el
    // documento queda 'pendiente' y se ve en la pantalla (Regla 18).
    const { docs, fallidos } = await subirDocumentos(
      [{ file: soporte, clase: "soporte" }], "cuentas-de-cobro",
      // La carpeta en Drive queda `Intake/cuentas-de-cobro/<NIT — Razón>/<envío>/`,
      // igual que la de un proveedor: quien busque el recibo del agua de agosto
      // no tiene que aprender una segunda convención. `envio` va en hora de
      // Bogotá — la VM vive en UTC.
      { nit, razon, envio: etiquetaEnvio() });

    // ¿ESTE GASTO SE REPITE? Acá nace la plantilla, y nace de un gasto REAL —con
    // su proveedor, su soporte y su valor— en vez de un formulario vacío: así
    // queda validada de entrada y nadie teclea lo mismo dos veces.
    const repetir = String(fd.get("repetir") ?? "") === "si";
    const diaPago = Number(String(fd.get("dia_pago") ?? "").trim());
    const formaPago = String(fd.get("forma_pago") ?? "pse").trim();
    const referencia = t("referencia_pago");
    const sitio = t("sitio_pago");
    const hasta = String(fd.get("vigente_hasta") ?? "").trim() || null;
    const anticipacion = Number(String(fd.get("dias_anticipacion") ?? "10").trim());
    if (repetir) {
      if (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31) {
        throw new Error("Escribe el día del mes en que hay que pagarlo (1 a 31).");
      }
      if (!esFormaPago(formaPago)) throw new Error("Elige cómo se paga este gasto.");
      // SIN REFERENCIA NO SE PUEDE PAGAR POR PSE: quien entre a la página del
      // proveedor no va a tener qué teclear, y ese es justo el trabajo que esto
      // viene a ahorrar. Si se paga por transferencia la cuenta sale del maestro
      // y no hace falta.
      if (formaPago !== "transferencia" && !referencia) {
        throw new Error("Falta la referencia de pago: es lo que se teclea en la página del "
          + "proveedor. Está en el recibo que acabas de adjuntar — cópiala de ahí, no de memoria.");
      }
      if (!Number.isInteger(anticipacion) || anticipacion < 0 || anticipacion > 60) {
        throw new Error("Los días de anticipación tienen que estar entre 0 y 60.");
      }
    }

    let id = 0;
    let plantilla = 0;
    await withTx(async (c) => {
      const r = await c.query<{ id: number }>(
        `INSERT INTO cuentas_cobro
           (razon_social, tipo_doc, num_doc, correo, area, descripcion, valor,
            documentos, estado, origen, tipo, tipo_detalle, numero, fecha_documento,
            creado_por, aprobado_en, revisado_por, revisado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'aprobada','interno',$9,$10,$11,$12,$13, now(), $13, now())
         RETURNING id`,
        [razon, String(fd.get("tipo_doc") ?? "NIT"), nit, limpiarCorreo(String(fd.get("correo") ?? "")),
         t("area"), t("descripcion"), valor, JSON.stringify(docs),
         tipo, detalle, t("numero"), fecha, user.email]);
      id = r.rows[0].id;
      if (repetir) {
        // Arranca el mes SIGUIENTE: el gasto que acaba de entrar ya se va a
        // pagar por el camino normal, y generarlo otra vez sería un duplicado el
        // primer día.
        const base = fecha ?? hoyBogota();
        plantilla = await crearPlantilla(c, {
          razon_social: razon, num_doc: nit, tipo_doc: String(fd.get("tipo_doc") ?? "NIT"),
          correo: limpiarCorreo(String(fd.get("correo") ?? "")) || null,
          tipo, tipo_detalle: detalle || null, descripcion: t("descripcion") || null,
          // Concepto y destino todavía no existen acá: los pone quien clasifica
          // en Conciliación, y desde ahí SUBEN solos a la plantilla (ver
          // `clasificar` en lib/documentos-no-dian.ts). Se clasifica una vez.
          concepto: null, destino: null, area: t("area") || null,
          forma_pago: formaPago, referencia_pago: referencia || null, sitio_pago: sitio || null,
          dia_pago: diaPago, dias_anticipacion: anticipacion,
          desde_periodo: mesSiguiente(mesDe(base)), vigente_hasta: hasta,
          // El valor de HOY no se hereda como monto fijo: es la primera muestra
          // de la serie contra la que se compara el mes entrante.
          valor_referencia: valor,
          documentos: docs, origen_doc_id: id,
        }, user);
        // El gasto que la originó queda amarrado a su plantilla. Sin esto la
        // primera muestra de la serie quedaría fuera de su propia historia.
        await c.query("UPDATE cuentas_cobro SET plantilla_id = $2 WHERE id = $1", [id, plantilla]);
      }
      await registrarEvento(c, {
        cufe: null, tipo: "crea_gasto_sin_factura", campo: "cuentas_cobro",
        valorNuevo: { id, ref: refDe(tipo, id), tipo, tipo_detalle: detalle,
                      razon_social: razon, nit, valor, docs_fallidos: fallidos,
                      plantilla_id: plantilla || null },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });

    revalidatePath("/contabilidad/conciliacion");
    revalidatePath("/contabilidad/cuentas-de-cobro");
    if (fallidos) {
      // No es un error que tumbe el registro, pero tampoco se calla: el soporte
      // hay que volver a subirlo y alguien tiene que enterarse.
      throw new Error(`Quedó registrado como ${refDe(tipo, id)}, pero el soporte NO se pudo subir a Drive. `
        + "Vuelve a adjuntarlo desde la bandeja de cuentas de cobro.");
    }
  });
}

/** GENERAR AHORA lo que ya debería existir.
 *
 *  El camino normal es el cron de la VM; esto es el botón para no tener que
 *  esperarlo —al crear una plantilla, o cuando alguien nota que falta el mes—.
 *  Es la MISMA función que corre el cron, así que no hay dos formas de que un
 *  documento nazca, y es idempotente: lo que ya existe no se duplica (el índice
 *  único de la base es quien lo impide, no un chequeo previo). */
export async function generarAhora(): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("clasificar");
    let n = 0;
    await withTx(async (c) => { n = (await generarPendientes(c, user)).length; });
    revalidatePath("/contabilidad/gasto-sin-factura");
    revalidatePath("/contabilidad/conciliacion");
    // "0 nuevos" no es un fallo, pero decirlo importa: sin mensaje, quien aprieta
    // el botón no sabe si no había nada o si no funcionó (Regla 18).
    if (!n) throw new Error("No había ningún mes pendiente por crear. Todo lo que vence "
      + "dentro de la ventana de anticipación ya está en Conciliación.");
  });
}

/** DAR DE BAJA una plantilla: deja de generar meses.
 *
 *  No borra nada. Los documentos que ya creó siguen su curso —son gastos reales,
 *  algunos ya pagados— y borrar la plantilla los dejaría apuntando a nada, sin
 *  forma de explicar de dónde salieron. Es lo que hay que hacer cuando cierra
 *  una tienda: si no, sigue produciendo obligaciones fantasma para siempre. */
export async function darDeBajaPlantilla(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("clasificar");
    const id = Number(fd.get("id"));
    const motivo = limpiarTextoHumano(String(fd.get("motivo") ?? "")) ?? "";
    if (!id) throw new Error("Falta la plantilla.");
    if (motivo.length < 4) {
      throw new Error("Escribe por qué se deja de generar (cerró la tienda, cambió de proveedor…): "
        + "dentro de seis meses nadie va a recordar por qué este gasto dejó de aparecer.");
    }
    await withTx(async (c) => { await darDeBaja(c, id, motivo, user); });
    revalidatePath("/contabilidad/gasto-sin-factura");
  });
}
