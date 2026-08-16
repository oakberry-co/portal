"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import type { PoolClient } from "pg";

async function guard() {
  return exigirCap("intake");
}
const done = () => revalidatePath("/contabilidad/cotizaciones");

/** Recalcula el abono aplicado a la factura enlazada de una cotización (para que
 *  Pagos descuente esos abonos → nunca doble). */
async function syncAbono(c: PoolClient, cotId: number) {
  const r = await c.query<{ cufe: string | null; abono: string }>(
    `SELECT cufe_factura AS cufe,
            coalesce((SELECT sum(monto) FROM cotizacion_abonos WHERE cotizacion_id = $1),0) AS abono
       FROM cotizaciones WHERE id = $1`, [cotId]);
  const cufe = r.rows[0]?.cufe;
  if (cufe) await c.query("UPDATE factura_estado SET abono_aplicado = $2, actualizado_en = now() WHERE cufe = $1",
    [cufe, Number(r.rows[0].abono)]);
}

const ESTADOS: Record<string, string> = {
  aprobar: "aprobada", rechazar: "rechazada", cerrar: "cerrada", reabrir: "recibida",
};

export async function revisarCotizacion(fd: FormData) {
  const user = await guard();
  const id = Number(fd.get("id"));
  const nuevo = ESTADOS[String(fd.get("accion") ?? "")];
  const nota = String(fd.get("nota") ?? "").trim() || null;
  if (!id || !nuevo) throw new Error("Acción inválida.");
  await withTx(async (c) => {
    await c.query("UPDATE cotizaciones SET estado=$2, nota_revision=COALESCE($3,nota_revision), revisado_por=$4, revisado_en=now() WHERE id=$1",
      [id, nuevo, nota, user.email]);
    await registrarEvento(c, { cufe: null, tipo: "revisa_cotizacion", campo: "estado", valorNuevo: { id, estado: nuevo }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}

/** Registra un abono (anticipo) contra la cotización. Si ya está enlazada a una
 *  factura, actualiza el abono aplicado (Pagos descuenta). */
export async function agregarAbono(fd: FormData) {
  const user = await guard();
  const cotId = Number(fd.get("cotizacion_id"));
  const monto = Number(String(fd.get("monto") ?? "").replace(/[^\d]/g, "")) || 0;
  const fecha = String(fd.get("fecha") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const cuenta = String(fd.get("cuenta_pago") ?? "").trim() || null;
  const comprobante = String(fd.get("comprobante_url") ?? "").trim() || null;
  if (!cotId || monto <= 0) throw new Error("Falta cotización o monto válido.");
  await withTx(async (c) => {
    await c.query("INSERT INTO cotizacion_abonos (cotizacion_id, monto, fecha, cuenta_pago, comprobante_url, creado_por) VALUES ($1,$2,$3,$4,$5,$6)",
      [cotId, monto, fecha, cuenta, comprobante, user.email]);
    await syncAbono(c, cotId);
    await registrarEvento(c, { cufe: null, tipo: "abono_cotizacion", campo: "abono", valorNuevo: { cotizacion_id: cotId, monto, fecha }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}

/** EL CRUCE: enlaza la factura final (DIAN) a la cotización. A partir de ahí Pagos
 *  descuenta los abonos de esa factura (saldo = valor − abonos). */
export async function enlazarFactura(fd: FormData) {
  const user = await guard();
  const cotId = Number(fd.get("cotizacion_id"));
  const cufe = String(fd.get("cufe") ?? "").trim();
  if (!cotId || !cufe) throw new Error("Falta cotización o factura.");
  await withTx(async (c) => {
    const dup = await c.query("SELECT 1 FROM cotizaciones WHERE cufe_factura=$1 AND id<>$2", [cufe, cotId]);
    if (dup.rowCount) throw new Error("Esa factura ya está enlazada a otra cotización.");
    await c.query("UPDATE cotizaciones SET cufe_factura=$2, estado='facturada' WHERE id=$1", [cotId, cufe]);
    await syncAbono(c, cotId);
    await registrarEvento(c, { cufe, tipo: "enlaza_cotizacion", campo: "cufe_factura", valorNuevo: { cotizacion_id: cotId, cufe }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}

export async function quitarEnlace(fd: FormData) {
  const user = await guard();
  const cotId = Number(fd.get("cotizacion_id"));
  if (!cotId) throw new Error("Falta cotización.");
  await withTx(async (c) => {
    const r = await c.query<{ cufe: string | null }>("SELECT cufe_factura AS cufe FROM cotizaciones WHERE id=$1", [cotId]);
    const cufe = r.rows[0]?.cufe;
    await c.query("UPDATE cotizaciones SET cufe_factura=NULL, estado='aprobada' WHERE id=$1", [cotId]);
    if (cufe) await c.query("UPDATE factura_estado SET abono_aplicado=0, actualizado_en=now() WHERE cufe=$1", [cufe]);
    await registrarEvento(c, { cufe: cufe ?? null, tipo: "quita_enlace_cotizacion", campo: "cufe_factura", valorNuevo: { cotizacion_id: cotId }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}
