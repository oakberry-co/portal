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
      fecha_emision: Date;
    }>(
      `SELECT e.estado, e.concepto, e.destino, e.plazo_dias, f.fecha_emision
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

    // Vencimiento = emisión + plazo.
    let vencimiento: string | null = null;
    if (nPlazo != null) {
      const d = new Date(antes.fecha_emision);
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
