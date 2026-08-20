import type { PoolClient } from "pg";
import { registrarEvento } from "@/lib/eventos";
import { nitCanonico } from "@/lib/nit";

/** Escribe en el maestro la cuenta que trae una certificación válida.
 *
 *  QUIÉN LA LLAMA IMPORTA: solo la APROBACIÓN en la bandeja (y la confirmación
 *  explícita de un cambio de cuenta). El lector de certificaciones NO la llama —
 *  a propósito.
 *
 *  Por qué: `cuentas_bancarias_proveedor` es de donde sale el archivo del banco
 *  para TODO, incluidas las facturas DIAN de ese mismo NIT. Si el lector
 *  escribiera ahí apenas procesa el documento, un envío del portal PÚBLICO —que
 *  nadie ha mirado— decidiría a qué cuenta se le pagan las facturas de ese
 *  proveedor. La cuenta entra al circuito de pago cuando un humano aprueba, no
 *  cuando un OCR termina.
 *
 *  Idempotente: si ya estaba aplicada no reescribe ni duplica el evento. */
export async function aplicarCuentaCertificada(
  c: PoolClient, certId: number, actor: { email: string; rol: string },
): Promise<void> {
  const { rows } = await c.query<{
    id: number; nit: string | null; estado: string; banco: string | null;
    tipo_cuenta: string | null; num_cuenta: string | null; titular_doc: string | null;
    cuenta_anterior: string | null; aplicada: boolean; cuenta_verificada: string | null;
  }>(
    `SELECT id, nit, estado, banco, tipo_cuenta, num_cuenta, titular_doc,
            cuenta_anterior, aplicada, cuenta_verificada
       FROM certificacion_bancaria WHERE id = $1 FOR UPDATE`, [certId]);
  const cert = rows[0];
  if (!cert) throw new Error("Certificación no encontrada.");
  if (cert.estado !== "valida") throw new Error("Solo se puede aplicar una certificación válida.");
  if (!cert.nit) throw new Error("La certificación no tiene NIT: no se sabe a qué proveedor aplicarla.");
  if (!cert.num_cuenta) throw new Error("La certificación no trae número de cuenta.");
  // LA QUE MANDA es la que un humano leyó del documento y escribió. El OCR es el
  // asistente: si el revisor corrigió lo leído, su número es el que va al banco.
  const cuenta = (cert.cuenta_verificada ?? "").trim();
  // El NIT entra por un formulario público: puede venir con el dígito de
  // verificación pegado. Si se guarda así, la cuenta no cruza con las facturas
  // de ese mismo proveedor y el pago se cae del archivo del banco (ver lib/nit.ts).
  const nit = nitCanonico(cert.nit);
  if (!cuenta) throw new Error("Nadie ha verificado esta cuenta contra el documento.");
  if (cert.aplicada) return;

  await c.query(
    `INSERT INTO cuentas_bancarias_proveedor
       (nit, banco, tipo_cuenta, num_cuenta, num_doc, fuente, certificacion_id, certificada, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,'certificacion',$6,TRUE, now())
     ON CONFLICT (nit) DO UPDATE SET
       banco = EXCLUDED.banco, tipo_cuenta = EXCLUDED.tipo_cuenta,
       num_cuenta = EXCLUDED.num_cuenta, fuente = 'certificacion',
       certificacion_id = EXCLUDED.certificacion_id, certificada = TRUE,
       actualizado_en = now()`,
    [nit, cert.banco, cert.tipo_cuenta, cuenta, cert.titular_doc, cert.id]);
  await c.query("UPDATE certificacion_bancaria SET aplicada = TRUE WHERE id = $1", [certId]);

  await registrarEvento(c, {
    cufe: null, tipo: cert.cuenta_anterior ? "cambia_cuenta_banco" : "aplica_cuenta_banco",
    campo: "num_cuenta",
    valorAnterior: cert.cuenta_anterior ? { nit: cert.nit, num_cuenta: cert.cuenta_anterior } : null,
    valorNuevo: { nit: cert.nit, num_cuenta: cuenta, banco: cert.banco,
                  leida_por_ocr: cert.num_cuenta, certificacion_id: cert.id },
    actor: actor.email, actorRol: actor.rol, origen: "web",
  });
}
