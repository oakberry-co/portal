"use server";

// CAMBIO DE CUENTA — la decisión que no puede tomar una máquina.
//
// El lector (scripts/leer_certificaciones.py) NUNCA escribe la cuenta en el
// maestro. Si el NIT ya tenía OTRA, deja la certificación 'valida' con la
// `cuenta_anterior` guardada y el cambio pasa por un humano ANTES de que se
// pueda aprobar la solicitud.
//
// Por qué: el intake es público. Cualquiera puede mandar una cuenta de cobro con
// el NIT de un proveedor grande y su propia certificación; si el sistema
// sobrescribiera, el siguiente pago masivo se iría a la cuenta del atacante y
// nadie lo notaría hasta que el proveedor real reclame.

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { aplicarCuentaCertificada } from "@/lib/cuenta-certificada";

function refrescar() {
  revalidatePath("/contabilidad/cuentas-de-cobro");
  revalidatePath("/contabilidad/cotizaciones");
}

/** Acepta la cuenta nueva: la escribe en el maestro y deja la certificación
 *  aplicada. A partir de aquí el proveedor entra al archivo del banco con ESA
 *  cuenta, y la anterior queda en la bitácora. */
export async function confirmarCambioCuenta(fd: FormData) {
  const user = await exigirCap("intake");
  const id = Number(fd.get("cert_id"));
  if (!id) throw new Error("Falta la certificación.");
  await withTx(async (c) => aplicarCuentaCertificada(c, id, user));
  refrescar();
}

/** Rechaza la cuenta nueva: la anterior queda intacta y el envío no se puede
 *  aprobar. Es la salida para un intento de suplantación. */
export async function rechazarCambioCuenta(fd: FormData) {
  const user = await exigirCap("intake");
  const id = Number(fd.get("cert_id"));
  if (!id) throw new Error("Falta la certificación.");
  await withTx(async (c) => {
    await c.query(
      `UPDATE certificacion_bancaria
          SET estado = 'no_coincide',
              motivo = 'La cuenta certificada no corresponde a la que el proveedor tiene registrada; '
                       || 'el cambio fue rechazado en la revisión.'
        WHERE id = $1 AND estado = 'valida'`, [id]);
    await registrarEvento(c, {
      cufe: null, tipo: "rechaza_cuenta_banco", campo: "num_cuenta",
      valorNuevo: { certificacion_id: id },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  refrescar();
}
