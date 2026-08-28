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
import { TIPOS_GASTO, DIAS_AVISO } from "@/lib/gastos-periodicos";

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

    // Sin fecha del documento se usa hoy: el plazo tiene que correr desde algún
    // lado, y pedir una fecha que casi siempre es la de hoy era un campo más.
    const fecha = hoyBogota();

    // EL SOPORTE ES OPCIONAL (28-ago-2026, decisión de Daniel probándolo).
    //
    // Era obligatorio con un argumento correcto —un pago sin respaldo es lo que
    // esto vino a evitar— pero en la práctica lo que hacía era que el gasto no
    // se cargara: quien tiene el recibo en la mano es quien paga, no siempre
    // quien registra. Un gasto registrado sin recibo se puede completar después;
    // uno que nunca se registró no existe para nadie.
    //
    // Lo que NO se hace es callarlo: la fila queda sin soporte a la vista y el
    // centinela `pagada_sin_soporte` ya vigila lo que se pagó sin respaldo.
    const soporte = fd.get("doc_soporte");
    const traeSoporte = soporte instanceof File && soporte.size > 0;

    // La subida va ANTES de abrir la transacción: puede tardar, y no se bloquean
    // filas mientras tanto. Si Drive falla NO se pierde el registro — el
    // documento queda 'pendiente' y se ve en la pantalla (Regla 18).
    const { docs, fallidos } = traeSoporte ? await subirDocumentos(
      [{ file: soporte as File, clase: "soporte" }], "cuentas-de-cobro",
      // La carpeta en Drive queda `Intake/cuentas-de-cobro/<NIT — Razón>/<envío>/`,
      // igual que la de un proveedor: quien busque el recibo del agua de agosto
      // no tiene que aprender una segunda convención. `envio` va en hora de
      // Bogotá — la VM vive en UTC.
      { nit, razon, envio: etiquetaEnvio() }) : { docs: [], fallidos: 0 };

    // LA REFERENCIA Y EL LINK SUBEN AL FORMULARIO PRINCIPAL (28-ago-2026).
    //
    // Estaban dentro del bloque de recurrencia, y no es ahí donde viven: un
    // recibo de una sola vez también se paga tecleando una referencia. Ahora se
    // piden siempre y el bloque de "se repite" quedó con una sola casilla.
    const referencia = t("referencia_pago");
    const sitio = t("link_pago");

    // CÓMO SE PAGA, DEDUCIDO — ya no se pregunta.
    //
    // Si el gasto trae REFERENCIA, es porque alguien la va a teclear en la
    // página del proveedor: se paga a mano y NO entra al archivo del banco. Sin
    // referencia, se transfiere como cualquier cuenta de cobro.
    //
    // La deducción está elegida por CUÁL ERROR SE VE. Si acierta mal hacia
    // "a mano", el pago se queda pendiente en el tablero y alguien lo nota; si
    // acertara mal hacia "transferencia", el banco lo giraría además de lo que
    // ya se pagó por la página — el proveedor cobra dos veces y no hay ningún
    // error de por medio. Se puede corregir después en el tablero de Pagos.
    const formaPago = referencia ? "pse" : "transferencia";

    // ¿ESTE GASTO SE REPITE? Acá nace la plantilla, y nace de un gasto REAL —con
    // su proveedor y su valor— en vez de un formulario vacío: así queda validada
    // de entrada y nadie teclea lo mismo dos veces.
    const repetir = String(fd.get("repetir") ?? "") === "si";
    const diaPago = Number(String(fd.get("dia_pago") ?? "").trim());
    const hasta: string | null = null;
    // AVISA 7 DÍAS ANTES, PARA TODOS. Era una casilla y nadie tiene por qué
    // decidirlo gasto por gasto: siete días es lo que alcanza para conseguir el
    // recibo y pagar sin llegar al corte.
    const anticipacion = DIAS_AVISO;
    if (repetir) {
      if (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31) {
        throw new Error("Escribe el día máximo en que hay que pagarlo (1 a 31).");
      }
    }

    let id = 0;
    let plantilla = 0;
    await withTx(async (c) => {
      const r = await c.query<{ id: number }>(
        `INSERT INTO cuentas_cobro
           (razon_social, tipo_doc, num_doc, correo, valor,
            documentos, estado, origen, tipo, tipo_detalle, numero, fecha_documento,
            forma_pago, referencia_pago, link_pago,
            creado_por, aprobado_en, revisado_por, revisado_en)
         VALUES ($1,$2,$3,$4,$5,$6,'aprobada','interno',$7,$8,$9,$10,$11,$12,$13,$14, now(), $14, now())
         RETURNING id`,
        [razon, String(fd.get("tipo_doc") ?? "NIT"), nit, limpiarCorreo(String(fd.get("correo") ?? "")),
         valor, JSON.stringify(docs),
         tipo, detalle, t("numero"), fecha,
         // Van EN EL DOCUMENTO y no solo en la plantilla: un gasto de una sola
         // vez también se paga tecleando una referencia, y quien paga la busca
         // en la fila que tiene delante.
         formaPago, referencia || null, sitio || null,
         user.email]);
      id = r.rows[0].id;
      if (repetir) {
        // Arranca el mes SIGUIENTE: el gasto que acaba de entrar ya se va a
        // pagar por el camino normal, y generarlo otra vez sería un duplicado el
        // primer día.
        const base = fecha ?? hoyBogota();
        plantilla = await crearPlantilla(c, {
          razon_social: razon, num_doc: nit, tipo_doc: String(fd.get("tipo_doc") ?? "NIT"),
          correo: limpiarCorreo(String(fd.get("correo") ?? "")) || null,
          tipo, tipo_detalle: detalle || null, descripcion: null,
          // Concepto y destino todavía no existen acá: los pone quien clasifica
          // en Conciliación, y desde ahí SUBEN solos a la plantilla (ver
          // `clasificar` en lib/documentos-no-dian.ts). Se clasifica una vez.
          concepto: null, destino: null, area: null,
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
