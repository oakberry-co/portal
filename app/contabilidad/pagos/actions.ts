"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { getCurrentUser, tienePermiso } from "@/lib/auth";
import type { PoolClient } from "pg";

const done = () => revalidatePath("/contabilidad/pagos");
const cufesDe = (fd: FormData) => String(fd.get("cufes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Registra un pago (una transferencia) que cubre 1..N facturas del MISMO proveedor.
 *  Si el monto < saldo total → abono (se aplica a las más antiguas primero; las que
 *  se saldan pasan a 'pagada' y salen del tablero, las parciales se quedan con su
 *  saldo). Comprobante opcional. Un evento en la bitácora. */
export async function registrarPago(fd: FormData) {
  const user = await getCurrentUser();
  if (!tienePermiso(user.rol, "pagador")) throw new Error("No autorizado: se requiere rol pagador.");

  const cufes = cufesDe(fd);
  if (!cufes.length) throw new Error("Selecciona al menos una factura.");
  const fecha = String(fd.get("fecha_pago") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const comprobante = String(fd.get("comprobante_url") ?? "").trim() || null;
  const nota = String(fd.get("nota") ?? "").trim() || null;
  const montoRaw = String(fd.get("monto") ?? "").replace(/[^\d.-]/g, "");

  await withTx(async (c: PoolClient) => {
    const { rows } = await c.query<{
      cufe: string; nit_proveedor: string; nombre_proveedor: string | null; estado: string;
      a_pagar: string; pagado: string;
    }>(
      `SELECT e.cufe, f.nit_proveedor, f.nombre_proveedor, e.estado,
              coalesce(e.valor_a_pagar, f.total) AS a_pagar, coalesce(e.pago_monto,0) AS pagado
       FROM factura_estado e JOIN facturas f USING (cufe)
       WHERE e.cufe = ANY($1) ORDER BY f.fecha_emision FOR UPDATE`, [cufes]);
    if (!rows.length) throw new Error("Facturas no encontradas.");

    const nit = rows[0].nit_proveedor;
    if (rows.some((r) => r.nit_proveedor !== nit)) throw new Error("Un pago cubre facturas de un solo proveedor.");
    for (const r of rows) {
      if (["capturada", "clasificada", "causada"].includes(r.estado)) {
        throw new Error(`La factura ${r.cufe} no está lista para pago (clasifica y retén primero).`);
      }
    }

    const saldos = rows.map((r) => {
      const aPagar = Number(r.a_pagar), pagado = Number(r.pagado);
      return { cufe: r.cufe, aPagar, pagado, saldo: Math.max(0, aPagar - pagado) };
    });
    const totalSaldo = saldos.reduce((s, x) => s + x.saldo, 0);
    const monto = montoRaw === "" ? totalSaldo : Number(montoRaw);
    if (!Number.isFinite(monto) || monto <= 0) throw new Error("Monto inválido.");
    if (monto > totalSaldo + 1) throw new Error("El monto supera el saldo pendiente del proveedor.");
    const tipo = monto >= totalSaldo - 1 ? "completo" : "abono";

    const pago = await c.query<{ id: number }>(
      `INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, comprobante_url, nota, pagado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [nit, fecha, monto, tipo, comprobante, nota, user.email]);
    const pagoId = pago.rows[0].id;

    let restante = monto;
    for (const s of saldos) {                       // más antiguas primero
      if (restante <= 0 || s.saldo <= 0) continue;
      const aplica = Math.min(restante, s.saldo);
      restante -= aplica;
      const nuevoPagado = s.pagado + aplica;
      const saldado = nuevoPagado >= s.aPagar - 1;   // tolerancia de $1 por redondeo
      await c.query("INSERT INTO pago_facturas (pago_id, cufe, monto_aplicado) VALUES ($1,$2,$3)", [pagoId, s.cufe, aplica]);
      await c.query(
        `UPDATE factura_estado SET pago_monto=$2, pago_estado=$3, pago_tipo=$4, fecha_pago=$5,
                estado=$6, actualizado_en=now() WHERE cufe=$1`,
        [s.cufe, nuevoPagado, saldado ? "pagado" : "parcial", tipo, fecha, saldado ? "pagada" : "retenciones_ok"]);
    }

    await registrarEvento(c, {
      cufe: null, tipo: "registra_pago", campo: "pago",
      valorNuevo: { proveedor: rows[0].nombre_proveedor, nit, monto, tipo, facturas: cufes.length, comprobante: !!comprobante, fecha },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  done();
}

/** "Pasar a otra semana": cambia la semana de pago PROGRAMADA (no toca el
 *  vencimiento real). */
export async function reprogramarSemana(fd: FormData) {
  const user = await getCurrentUser();
  if (!tienePermiso(user.rol, "pagador")) throw new Error("No autorizado: se requiere rol pagador.");
  const cufes = cufesDe(fd);
  const fecha = String(fd.get("fecha") ?? "").trim();
  if (!cufes.length || !fecha) throw new Error("Falta selección o fecha.");
  await withTx(async (c) => {
    await c.query("UPDATE factura_estado SET fecha_pago_prog=$2, actualizado_en=now() WHERE cufe = ANY($1)", [cufes, fecha]);
    await registrarEvento(c, { cufe: null, tipo: "reprograma_pago", campo: "semana", valorNuevo: { facturas: cufes.length, fecha }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}
