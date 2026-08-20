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
import { refDe } from "@/lib/documentos-no-dian";
import { TIPOS } from "./tipos";

export async function crearGastoSinFactura(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("clasificar");

    const t = (k: string) => limpiarTextoHumano(String(fd.get(k) ?? ""));
    const tipo = String(fd.get("tipo") ?? "").trim();
    if (!TIPOS.some((x) => x.valor === tipo)) throw new Error("Elige si es un servicio público u otro gasto.");
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

    let id = 0;
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
      await registrarEvento(c, {
        cufe: null, tipo: "crea_gasto_sin_factura", campo: "cuentas_cobro",
        valorNuevo: { id, ref: refDe(tipo, id), tipo, tipo_detalle: detalle,
                      razon_social: razon, nit, valor, docs_fallidos: fallidos },
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
