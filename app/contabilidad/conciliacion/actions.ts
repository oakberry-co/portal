"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { getCurrentUser, tienePermiso } from "@/lib/auth";
import type { PoolClient } from "pg";

// Si el valor no existe en el maestro, lo crea (autoridad humana) y lo registra.
// Esto es lo que pediste: cada vez que ponemos un valor nuevo, alimenta el maestro.
async function asegurarConcepto(c: PoolClient, nombre: string, actor: string) {
  const r = await c.query("SELECT 1 FROM maestro_conceptos WHERE nombre = $1", [nombre]);
  if (r.rowCount === 0) {
    await c.query("INSERT INTO maestro_conceptos (nombre, creado_por) VALUES ($1,$2)", [nombre, actor]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "concepto", valorNuevo: nombre, actor });
  }
}
async function asegurarDestino(c: PoolClient, nombre: string, actor: string) {
  const r = await c.query("SELECT 1 FROM maestro_destinos WHERE nombre = $1", [nombre]);
  if (r.rowCount === 0) {
    await c.query("INSERT INTO maestro_destinos (nombre, creado_por) VALUES ($1,$2)", [nombre, actor]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "destino", valorNuevo: nombre, actor });
  }
}

/** Guarda concepto + destino + plazo de una factura. Estado + bitácora, atómico. */
export async function guardarClasificacion(formData: FormData) {
  const user = await getCurrentUser();
  if (!tienePermiso(user.rol, "conciliador")) {
    throw new Error("No autorizado: se requiere rol conciliador.");
  }

  const cufe = String(formData.get("cufe") ?? "").trim();
  const concepto = String(formData.get("concepto") ?? "").trim() || null;
  const destino = String(formData.get("destino") ?? "").trim() || null;
  const plazoRaw = String(formData.get("plazo_dias") ?? "").trim();
  const plazoDias = plazoRaw === "" ? null : Number.parseInt(plazoRaw, 10);
  if (!cufe) throw new Error("Falta cufe.");
  if (plazoDias !== null && (Number.isNaN(plazoDias) || plazoDias < 0)) {
    throw new Error("Plazo inválido.");
  }

  await withTx(async (c) => {
    // Estado + factura actuales (para valor_anterior y la fecha de emisión).
    const cur = await c.query<{
      estado: string; concepto: string | null; destino: string | null; plazo_dias: number | null;
      fecha_emision: Date; sincronizado_en: Date | null;
    }>(
      `SELECT e.estado, e.concepto, e.destino, e.plazo_dias, f.fecha_emision, f.sincronizado_en
         FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE e.cufe = $1 FOR UPDATE`,
      [cufe]
    );
    if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
    const antes = cur.rows[0];

    // Alimentar maestros con lo nuevo (autoridad humana).
    if (concepto) await asegurarConcepto(c, concepto, user.email);
    if (destino) await asegurarDestino(c, destino, user.email);

    // Merge: no borrar lo que ya había si el form vino parcial.
    const nConcepto = concepto ?? antes.concepto;
    const nDestino = destino ?? antes.destino;
    const nPlazo = plazoDias ?? antes.plazo_dias;

    // Día de pago = fecha de RECEPCIÓN + plazo (no la de emisión). Recepción =
    // cuando la factura entró al portal (sincronizado_en); si falta, cae a emisión.
    let vencimiento: string | null = null;
    if (nPlazo != null) {
      const base = antes.sincronizado_en ?? antes.fecha_emision;
      const d = new Date(base);
      d.setDate(d.getDate() + nPlazo);
      vencimiento = d.toISOString().slice(0, 10);
    }

    // Avanza a 'clasificada' solo si están los tres y aún estaba 'capturada'.
    const completa = !!nConcepto && !!nDestino && nPlazo != null;
    const nuevoEstado = completa && antes.estado === "capturada" ? "clasificada" : antes.estado;

    await c.query(
      `UPDATE factura_estado
          SET concepto = $2, concepto_fuente = 'humano',
              destino = $3, destino_fuente = 'humano',
              plazo_dias = $4, fecha_vencimiento = $5,
              estado = $6, actualizado_en = now()
        WHERE cufe = $1`,
      [cufe, nConcepto, nDestino, nPlazo, vencimiento, nuevoEstado]
    );

    await registrarEvento(c, {
      cufe,
      tipo: "set_clasificacion",
      campo: "concepto/destino/plazo",
      valorAnterior: { concepto: antes.concepto, destino: antes.destino, plazo_dias: antes.plazo_dias, estado: antes.estado },
      valorNuevo: { concepto: nConcepto, destino: nDestino, plazo_dias: nPlazo, estado: nuevoEstado },
      actor: user.email,
      actorRol: user.rol,
      origen: "web",
    });
  });

  revalidatePath("/contabilidad/conciliacion");
}

/** Acción combinada (rápida, 1 clic por fila): guarda clasificación
 *  (concepto·destino·plazo) + retenciones (RF/IVA/ICA) en una sola transacción.
 *  Avanza a 'retenciones_ok' cuando la clasificación está completa; si va parcial,
 *  guarda lo que haya sin forzar el avance. Todo con su evento en la bitácora. */
export async function validarFactura(formData: FormData) {
  const user = await getCurrentUser();
  if (!tienePermiso(user.rol, "conciliador")) {
    throw new Error("No autorizado: se requiere rol conciliador.");
  }

  const cufe = String(formData.get("cufe") ?? "").trim();
  if (!cufe) throw new Error("Falta cufe.");
  const concepto = String(formData.get("concepto") ?? "").trim() || null;
  const destino = String(formData.get("destino") ?? "").trim() || null;
  const plazoRaw = String(formData.get("plazo_dias") ?? "").trim();
  const plazoDias = plazoRaw === "" ? null : Number.parseInt(plazoRaw, 10);
  if (plazoDias !== null && (Number.isNaN(plazoDias) || plazoDias < 0)) throw new Error("Plazo inválido.");

  const monto = (k: string): number => {
    const raw = String(formData.get(k) ?? "").trim().replace(/[^\d.-]/g, "");
    if (raw === "") return 0;
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) throw new Error(`Valor inválido en ${k}.`);
    return n;
  };
  const retefuente = monto("retefuente");
  const reteiva = monto("reteiva");
  const reteica = monto("reteica");
  const retenTotal = retefuente + reteiva + reteica;

  await withTx(async (c) => {
    const cur = await c.query<{
      estado: string; concepto: string | null; destino: string | null; plazo_dias: number | null;
      retefuente: string | null; reteiva: string | null; reteica: string | null;
      fecha_emision: Date; total: string | null;
    }>(
      `SELECT e.estado, e.concepto, e.destino, e.plazo_dias, e.retefuente, e.reteiva, e.reteica,
              f.fecha_emision, f.total
         FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE e.cufe = $1 FOR UPDATE`,
      [cufe]
    );
    if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
    const antes = cur.rows[0];
    if (!["capturada", "clasificada", "retenciones_ok"].includes(antes.estado)) {
      throw new Error("La factura ya no es editable en este estado.");
    }

    if (concepto) await asegurarConcepto(c, concepto, user.email);
    if (destino) await asegurarDestino(c, destino, user.email);

    // Merge: no borrar lo que ya había si el form vino parcial.
    const nConcepto = concepto ?? antes.concepto;
    const nDestino = destino ?? antes.destino;
    const nPlazo = plazoDias ?? antes.plazo_dias;

    let vencimiento: string | null = null;
    if (nPlazo != null) {
      const d = new Date(antes.fecha_emision);
      d.setDate(d.getDate() + nPlazo);
      vencimiento = d.toISOString().slice(0, 10);
    }

    const total = antes.total != null ? Number(antes.total) : 0;
    const valorAPagar = total - retenTotal;
    const completa = !!nConcepto && !!nDestino && nPlazo != null;
    const nuevoEstado = completa ? "retenciones_ok" : (nConcepto || nDestino || nPlazo != null) ? "clasificada" : "capturada";

    await c.query(
      `UPDATE factura_estado
          SET concepto = $2, concepto_fuente = 'humano',
              destino = $3, destino_fuente = 'humano',
              plazo_dias = $4, fecha_vencimiento = $5,
              retefuente = $6, reteiva = $7, reteica = $8,
              reten_total = $9, valor_a_pagar = $10, retencion_ok = $11,
              estado = $12, actualizado_en = now()
        WHERE cufe = $1`,
      [cufe, nConcepto, nDestino, nPlazo, vencimiento, retefuente, reteiva, reteica, retenTotal, valorAPagar, completa, nuevoEstado]
    );

    await registrarEvento(c, {
      cufe,
      tipo: "valida_factura",
      campo: "clasificacion+retenciones",
      valorAnterior: {
        concepto: antes.concepto, destino: antes.destino, plazo_dias: antes.plazo_dias,
        retefuente: antes.retefuente, reteiva: antes.reteiva, reteica: antes.reteica, estado: antes.estado,
      },
      valorNuevo: {
        concepto: nConcepto, destino: nDestino, plazo_dias: nPlazo,
        retefuente, reteiva, reteica, reten_total: retenTotal, valor_a_pagar: valorAPagar, estado: nuevoEstado,
      },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });

  revalidatePath("/contabilidad/conciliacion");
}

/** Confirma las retenciones (ReteFuente/ReteIVA/ReteICA) de una factura ya
 *  clasificada: guarda los montos + total + valor a pagar, avanza a
 *  'retenciones_ok' y deja el evento. Atómico (estado + bitácora en la misma tx). */
export async function confirmarRetenciones(formData: FormData) {
  const user = await getCurrentUser();
  // Transición clasificada -> retenciones_ok (ROL_REQUERIDO["clasificada"] = conciliador).
  if (!tienePermiso(user.rol, "conciliador")) {
    throw new Error("No autorizado: se requiere rol conciliador.");
  }

  const cufe = String(formData.get("cufe") ?? "").trim();
  if (!cufe) throw new Error("Falta cufe.");

  const monto = (k: string): number => {
    const raw = String(formData.get(k) ?? "").trim().replace(/[^\d.-]/g, "");
    if (raw === "") return 0;
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) throw new Error(`Valor inválido en ${k}.`);
    return n;
  };
  const retefuente = monto("retefuente");
  const reteiva = monto("reteiva");
  const reteica = monto("reteica");
  const retenTotal = retefuente + reteiva + reteica;

  await withTx(async (c) => {
    const cur = await c.query<{
      estado: string; retefuente: string | null; reteiva: string | null;
      reteica: string | null; reten_total: string | null; total: string | null;
    }>(
      `SELECT e.estado, e.retefuente, e.reteiva, e.reteica, e.reten_total, f.total
         FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE e.cufe = $1 FOR UPDATE`,
      [cufe]
    );
    if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
    const antes = cur.rows[0];

    if (antes.estado === "capturada") {
      throw new Error("Clasifica la factura (concepto · destino · plazo) antes de confirmar retenciones.");
    }
    if (antes.estado !== "clasificada" && antes.estado !== "retenciones_ok") {
      throw new Error("Las retenciones ya no se pueden editar en este estado.");
    }

    const total = antes.total != null ? Number(antes.total) : 0;
    const valorAPagar = total - retenTotal;

    await c.query(
      `UPDATE factura_estado
          SET retefuente = $2, reteiva = $3, reteica = $4,
              reten_total = $5, valor_a_pagar = $6,
              retencion_ok = TRUE, estado = 'retenciones_ok', actualizado_en = now()
        WHERE cufe = $1`,
      [cufe, retefuente, reteiva, reteica, retenTotal, valorAPagar]
    );

    await registrarEvento(c, {
      cufe,
      tipo: "valida_retencion",
      campo: "retenciones",
      valorAnterior: {
        retefuente: antes.retefuente, reteiva: antes.reteiva, reteica: antes.reteica,
        reten_total: antes.reten_total, estado: antes.estado,
      },
      valorNuevo: {
        retefuente, reteiva, reteica, reten_total: retenTotal,
        valor_a_pagar: valorAPagar, estado: "retenciones_ok",
      },
      actor: user.email,
      actorRol: user.rol,
      origen: "web",
    });
  });

  revalidatePath("/contabilidad/conciliacion");
}
