"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { docsFaltantes, type DocGuardado, PLAZO_CUENTA_COBRO_DIAS } from "@/lib/areas";
import { bloqueoAprobacion, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { aplicarCuentaCertificada } from "@/lib/cuenta-certificada";
import { encolarCorreo } from "@/lib/correos";
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
            to_jsonb(cert) AS cert,
            to_jsonb(cb)   AS cuenta
       FROM cuentas_cobro cc
       LEFT JOIN LATERAL (
         SELECT x.id, x.estado, x.motivo, x.banco, x.num_cuenta, x.aplicada,
                x.cuenta_anterior, x.leido_en::text AS leido_en
           FROM certificacion_bancaria x
          WHERE x.origen_tipo = 'cuenta_cobro' AND x.origen_id = cc.id
          ORDER BY x.id DESC LIMIT 1) cert ON TRUE
       LEFT JOIN LATERAL (
         SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
           FROM cuentas_bancarias_proveedor y WHERE y.nit = cc.num_doc) cb ON TRUE
      WHERE cc.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new Error("Cuenta de cobro no encontrada.");
  const bloqueo = bloqueoAprobacion(docsFaltantes(r.documentos), r.cert, r.cuenta);
  if (bloqueo) throw new Error(bloqueo);
  return { ...r, certId: r.cert!.id };
}

/** Lo que hace falta para aprobar Y para escribirle al proveedor. */
type Aprobable = {
  razon_social: string; correo: string | null; valor: number | null; certId: number;
};

/** Revisa una cuenta de cobro: aprobar / rechazar / devolver a revisión.
 *
 *  APROBAR es el paso que la convierte en plata: pasa al tablero de Pagos, al
 *  bloque "sin factura DIAN" de Validación semana en curso, con fecha de pago a
 *  30 días de su llegada. Por eso exige los documentos completos y la cuenta
 *  certificada por el banco. */
export async function revisarCuentaCobro(fd: FormData) {
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
        datos: { ref: `CC-${id}`, proveedor: ap.razon_social, valor: ap.valor,
                 plazo_dias: PLAZO_CUENTA_COBRO_DIAS },
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
}
