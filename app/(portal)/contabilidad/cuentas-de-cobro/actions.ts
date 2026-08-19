"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { docsFaltantes, type DocGuardado, PLAZO_CUENTA_COBRO_DIAS } from "@/lib/areas";
import { bloqueoAprobacion, sqlCertificacion, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { aplicarCuentaCertificada } from "@/lib/cuenta-certificada";
import { encolarCorreo } from "@/lib/correos";
import { intentar, type Resultado } from "@/lib/resultado";
import type { PoolClient } from "pg";

async function guard() {
  return exigirCap("intake");
}

// 'pagar' YA NO se marca desde acá: el pago se confirma en Pagos, que además
// crea el registro del Historial. Marcarla pagada a mano dejaba plata sin
// respaldo en `pagos` — un pagado que no existe en ninguna parte.
const ESTADOS: Record<string, string> = {
  aprobar: "aprobada", rechazar: "rechazada", reabrir: "recibida",
};

/** Vuelve a evaluar los candados CONTRA LA BASE en el momento de aprobar.
 *
 *  La bandeja ya los muestra, pero eso es la UI: entre que la página se pintó y
 *  alguien hizo clic pudieron llegar el documento que faltaba, o el veredicto
 *  del lector. Lo que decide es este SELECT, no lo que el navegador creía. */
async function exigirAprobable(c: PoolClient, id: number): Promise<Aprobable> {
  const { rows } = await c.query<Aprobable & {
    documentos: DocGuardado[]; cert: CertEstado | null; cuenta: CuentaMaestro;
  }>(
    `SELECT cc.documentos, cc.razon_social, cc.correo, cc.valor::float AS valor,
            cc.retencion_ok, coalesce(cc.valor_a_pagar, cc.valor)::float AS valor_a_pagar,
            to_jsonb(cert) AS cert,
            to_jsonb(cb)   AS cuenta
       FROM cuentas_cobro cc
       ${sqlCertificacion("cuenta_cobro", "cc.id")}
       LEFT JOIN LATERAL (
         SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
           FROM cuentas_bancarias_proveedor y WHERE y.nit = cc.num_doc) cb ON TRUE
      WHERE cc.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new Error("Cuenta de cobro no encontrada.");
  const bloqueo = bloqueoAprobacion(docsFaltantes(r.documentos), r.cert, r.cuenta);
  if (bloqueo) throw new Error(bloqueo);
  // Igual que una factura no entra a Pagos hasta 'retenciones_ok': aprobar sin
  // definir la retención es aprobar un pago BRUTO, y eso se paga de más.
  if (!r.retencion_ok) {
    throw new Error("Falta confirmar las retenciones. Ábrelas y confírmalas —aunque sean cero— "
                  + "para que se pague el valor correcto.");
  }
  return { ...r, certId: r.cert!.id };
}

/** Lo que hace falta para aprobar Y para escribirle al proveedor. */
type Aprobable = {
  razon_social: string; correo: string | null; valor: number | null;
  retencion_ok: boolean; valor_a_pagar: number | null; certId: number;
};

/** Revisa una cuenta de cobro: aprobar / rechazar / devolver a revisión.
 *
 *  APROBAR es el paso que la convierte en plata: pasa al tablero de Pagos, al
 *  bloque "sin factura DIAN" de Validación semana en curso, con fecha de pago a
 *  30 días de su llegada. Por eso exige los documentos completos y la cuenta
 *  certificada por el banco. */
export async function revisarCuentaCobro(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
  const user = await guard();
  const id = Number(fd.get("id"));
  const accion = String(fd.get("accion") ?? "").trim();
  const nota = String(fd.get("nota") ?? "").trim() || null;
  const nuevo = ESTADOS[accion];
  if (!id || !nuevo) throw new Error("Acción inválida.");
  await withTx(async (c) => {
    if (accion === "aprobar") {
      // Aprobar es lo que mete la cuenta al circuito de pago: hasta acá el
      // documento estaba leído pero su cuenta NO vivía en el maestro del que
      // sale el archivo del banco. Va en la MISMA transacción que el cambio de
      // estado — aprobado sin cuenta sería un pago que nunca puede salir.
      const ap = await exigirAprobable(c, id);
      await aplicarCuentaCertificada(c, ap.certId, user);
      // El correo que le pide la factura. Va en esta misma transacción: si algo
      // falla no queda ni la aprobación ni el correo (y si SES está caído, el
      // correo se reintenta sin perder la aprobación).
      await encolarCorreo(c, {
        tipo: "aprobacion", origenTipo: "cuenta_cobro", origenId: id,
        para: ap.correo, actor: user.email,
        datos: { ref: `CC-${id}`, proveedor: ap.razon_social,
                 valor: ap.valor_a_pagar ?? ap.valor,   // NETO: lo que va a recibir
                 valor_bruto: ap.valor,
                 retenciones: (ap.valor ?? 0) - (ap.valor_a_pagar ?? ap.valor ?? 0),
                 plazo_dias: PLAZO_CUENTA_COBRO_DIAS },
      });
    }
    if (accion === "rechazar") {
      // Rechazar sin avisar deja al proveedor esperando para siempre — y sin
      // motivo, no sabe qué corregir. El correo lleva el enlace para que suba
      // SOLO lo que falta, no todo el formulario otra vez.
      if (!nota) throw new Error("Escribe por qué la devuelves: el proveedor lo va a leer.");
      const { rows } = await c.query<{ correo: string | null; razon_social: string; token: string | null }>(
        "SELECT correo, razon_social, token FROM cuentas_cobro WHERE id = $1", [id]);
      await encolarCorreo(c, {
        tipo: "rechazo", origenTipo: "cuenta_cobro", origenId: id,
        para: rows[0]?.correo ?? null, actor: user.email,
        datos: { ref: `CC-${id}`, proveedor: rows[0]?.razon_social, motivo: nota,
                 token: rows[0]?.token },
      });
    }
    if (accion === "reabrir") {
      // Un pago registrado no se deshace devolviendo el envío a la bandeja: el
      // dinero ya salió y el `pagos` seguiría ahí. Si de verdad hay que
      // corregirlo, se corrige el pago.
      const { rows } = await c.query<{ pago_id: number | null }>(
        "SELECT pago_id FROM cuentas_cobro WHERE id = $1", [id]);
      if (rows[0]?.pago_id) throw new Error("Esta cuenta de cobro ya tiene un pago registrado: no se puede devolver a revisión.");
    }
    await c.query(
      `UPDATE cuentas_cobro
          SET estado = $2, nota_revision = COALESCE($3, nota_revision),
              revisado_por = $4, revisado_en = now(),
              aprobado_en = CASE WHEN $2 = 'aprobada' THEN now() ELSE aprobado_en END,
              -- volver a la bandeja la saca del tablero de Pagos
              cuenta_pago = CASE WHEN $2 = 'aprobada' THEN cuenta_pago ELSE NULL END,
              -- 30 días desde que llegó (política de la casa). Se calcula al
              -- aprobar para los envíos anteriores a la regla, que la tienen NULL.
              fecha_pago_prog = CASE WHEN $2 = 'aprobada'
                THEN COALESCE(fecha_pago_prog, (creado_en AT TIME ZONE 'America/Bogota')::date + $5::int)
                ELSE fecha_pago_prog END
        WHERE id = $1`,
      [id, nuevo, nota, user.email, PLAZO_CUENTA_COBRO_DIAS]);
    await registrarEvento(c, {
      cufe: null, tipo: "revisa_cuenta_cobro", campo: "estado",
      valorNuevo: { id, estado: nuevo, accion }, actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  revalidatePath("/contabilidad/cuentas-de-cobro");
  revalidatePath("/contabilidad/pagos");
  });
}

/** RETENCIONES DE UNA CUENTA DE COBRO — el mismo modelo que la factura.
 *
 *  Se pagaba por el valor BRUTO, y a una persona natural casi siempre hay que
 *  practicarle ReteFuente. Pagar de más no se devuelve solo: toca pedirle la
 *  plata de vuelta al proveedor, que es la conversación que nadie quiere.
 *
 *  Llegan los MONTOS ya calculados (el modal hace la aritmética con las tarifas
 *  a la vista, igual que en la grilla de facturas) y acá se guarda el resultado
 *  + el `valor_a_pagar`, que es lo que de verdad viaja a Pagos y al banco.
 *
 *  Confirmar CERO también es una decisión: `retencion_ok` se pone en TRUE aunque
 *  todos los montos sean 0. Por eso es un booleano y no se deduce de los montos. */
export async function confirmarRetencionesCuentaCobro(fd: FormData) {
  const user = await exigirCap("retenciones");
  const id = Number(fd.get("id"));
  if (!id) throw new Error("Falta la cuenta de cobro.");

  const monto = (k: string): number => {
    const raw = String(fd.get(k) ?? "").trim().replace(/[^\d.-]/g, "");
    if (raw === "") return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Valor inválido en ${k}.`);
    return n;
  };
  const retefuente = monto("retefuente");
  const reteiva = monto("reteiva");
  const reteica = monto("reteica");
  const ivaIncluido = monto("iva_incluido");
  const otros = monto("otros_valor");
  const retenTotal = retefuente + reteiva + reteica;
  const otrosConcepto = String(fd.get("otros_concepto") ?? "").trim() || null;
  const observaciones = String(fd.get("observaciones") ?? "").trim() || null;

  await withTx(async (c) => {
    const { rows } = await c.query<{ valor: string | null; estado: string; pago_id: number | null }>(
      "SELECT valor, estado, pago_id FROM cuentas_cobro WHERE id = $1 FOR UPDATE", [id]);
    const cc = rows[0];
    if (!cc) throw new Error("Cuenta de cobro no encontrada.");
    if (cc.pago_id) throw new Error("Ya está pagada: las retenciones no se pueden cambiar.");
    const valor = Number(cc.valor ?? 0);
    if (valor <= 0) throw new Error("La cuenta de cobro no tiene valor.");
    if (ivaIncluido > valor) throw new Error("El IVA incluido no puede ser mayor que el valor.");

    const valorAPagar = valor - retenTotal - otros;
    // Retener más de lo que vale el cobro es siempre un error de digitación.
    if (valorAPagar <= 0) {
      throw new Error("Las retenciones y descuentos se comen todo el valor. Revisa las tarifas.");
    }

    await c.query(
      `UPDATE cuentas_cobro
          SET iva_incluido = $2, retefuente = $3, reteiva = $4, reteica = $5,
              reten_total = $6, otros_valor = $7, otros_concepto = $8,
              valor_a_pagar = $9, observaciones = $10, retencion_ok = TRUE,
              retenciones_por = $11, retenciones_en = now()
        WHERE id = $1`,
      [id, ivaIncluido, retefuente, reteiva, reteica, retenTotal, otros, otrosConcepto,
       valorAPagar, observaciones, user.email]);

    await registrarEvento(c, {
      cufe: null, tipo: "retenciones_cuenta_cobro", campo: "valor_a_pagar",
      valorAnterior: { valor },
      valorNuevo: { id, retefuente, reteiva, reteica, otros, valor_a_pagar: valorAPagar },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  revalidatePath("/contabilidad/cuentas-de-cobro");
  revalidatePath("/contabilidad/pagos");
}
