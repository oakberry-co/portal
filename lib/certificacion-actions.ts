"use server";

// LA CUENTA BANCARIA LA ESCRIBE UNA PERSONA. PUNTO.
//
// El lector (scripts/leer_certificaciones.py) sigue leyendo la certificación y
// lo que saca se muestra como AYUDA para no teclear desde cero, pero no compara,
// no reclama y no tranca nada. Quien revisa abre el documento, escribe banco,
// tipo y número, y le da guardar: eso entra al maestro de cuentas.
//
// Antes había tres pantallas encima de esto —el choque contra lo que leyó el
// OCR, la confirmación de "cambió la cuenta" y las dos salidas de ese cambio— y
// entre todas hacían que aprobar una cuenta de cobro fuera un trámite de cinco
// pasos. Decisión de Daniel (21-ago-2026): la cuenta se escribe, no se valida.
//
// Lo que NO se perdió: cada guardado queda en la bitácora con la cuenta que
// había antes, así que un cambio raro se ve — después, no antes.

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { nitCanonico } from "@/lib/nit";
import { esBancoConocido } from "@/lib/bancos";

function refrescar() {
  revalidatePath("/contabilidad/cuentas-de-cobro");
  revalidatePath("/contabilidad/cotizaciones");
  revalidatePath("/contabilidad/pagos");
  revalidatePath("/contabilidad/maestros");
}

/** Guarda la cuenta del proveedor: banco, tipo y número, tal como los escribió
 *  quien tiene el documento delante. Va DERECHO al maestro de cuentas — que es
 *  de donde sale el archivo con el que el banco paga.
 *
 *  Se guarda al confirmar y no al aprobar: el paso 2 del flujo es "valida la
 *  cuenta y escríbela", y esperar hasta la aprobación dejaba el maestro
 *  desactualizado en medio de un trámite que puede durar días.
 *
 *  Lo único que se exige es que los tres campos estén: sin banco no hay código
 *  para el archivo y la fila sale vacía; sin número no hay a dónde pagar. El
 *  banco se elige de una lista porque su nombre se traduce a un código numérico
 *  (lib/bancos.ts) — "BACOLOMBIA" escrito a mano no resuelve a ninguno y el
 *  banco rechaza la fila, sin que nadie se entere hasta el día del pago. */
export async function guardarCuenta(fd: FormData) {
  const user = await exigirCap("intake");
  const certId = Number(fd.get("cert_id")) || null;
  const nitCrudo = String(fd.get("nit") ?? "").trim();
  const banco = String(fd.get("banco") ?? "").trim();
  const tipo = String(fd.get("tipo_cuenta") ?? "").trim();
  const numero = String(fd.get("num_cuenta") ?? "").replace(/[^\d]/g, "");

  if (!nitCrudo) throw new Error("Falta el NIT del proveedor.");
  if (!esBancoConocido(banco)) throw new Error("Elige el banco de la lista.");
  if (tipo !== "ahorros" && tipo !== "corriente") throw new Error("Di si es de ahorros o corriente.");
  if (numero.length < 5) throw new Error("Escribe el número de cuenta.");
  // El NIT puede llegar con el dígito de verificación pegado desde el formulario
  // público. Si se guarda así, la cuenta no cruza con las facturas del mismo
  // proveedor y el pago se cae del archivo del banco (ver lib/nit.ts).
  const nit = nitCanonico(nitCrudo);

  await withTx(async (c) => {
    const previa = await c.query<{ banco: string | null; tipo_cuenta: string | null; num_cuenta: string | null }>(
      "SELECT banco, tipo_cuenta, num_cuenta FROM cuentas_bancarias_proveedor WHERE nit = $1", [nit]);
    const antes = previa.rows[0] ?? null;

    await c.query(
      `INSERT INTO cuentas_bancarias_proveedor
         (nit, banco, tipo_cuenta, num_cuenta, fuente, certificacion_id, certificada, actualizado_en)
       VALUES ($1,$2,$3,$4,'certificacion',$5,TRUE, now())
       ON CONFLICT (nit) DO UPDATE SET
         banco = EXCLUDED.banco, tipo_cuenta = EXCLUDED.tipo_cuenta,
         num_cuenta = EXCLUDED.num_cuenta, fuente = 'certificacion',
         certificacion_id = EXCLUDED.certificacion_id, certificada = TRUE,
         actualizado_en = now()`,
      [nit, banco, tipo, numero, certId]);

    // La certificación de ESTE envío queda marcada con lo que escribió el
    // humano: es lo que la bandeja muestra como "cuenta confirmada".
    if (certId) {
      await c.query(
        `UPDATE certificacion_bancaria
            SET cuenta_verificada = $2, banco_verificado = $3, tipo_verificado = $4,
                verificada_por = $5, verificada_en = now(), aplicada = TRUE
          WHERE id = $1`, [certId, numero, banco, tipo, user.email]);
    }

    await registrarEvento(c, {
      cufe: null, tipo: "guarda_cuenta_banco", campo: "num_cuenta",
      valorAnterior: antes ? { nit, ...antes } : null,
      valorNuevo: { nit, banco, tipo_cuenta: tipo, num_cuenta: numero, certificacion_id: certId },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  refrescar();
  return { ok: true as const };
}
