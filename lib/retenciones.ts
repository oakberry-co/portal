// GUARDAR RETENCIONES — UN SOLO CAMINO.
//
// Las retenciones se van a poder confirmar desde dos lados: el modal de la
// grilla y el Excel que el equipo llena a mano y vuelve a subir. Si cada uno
// escribiera por su cuenta, en un mes harían cosas distintas — es exactamente
// como se rompió el candado de aprobación el 19-ago: había dos copias de la
// misma consulta y una envejeció sin que nadie lo notara.
//
// Así que la escritura vive aquí y los dos llaman a lo mismo. Lo único que
// cambia entre ellos es de dónde salen los montos y quién los confirma.

import type { PoolClient } from "pg";
import { registrarEvento } from "@/lib/eventos";

/** Los montos EN PESOS de una retención. No porcentajes: el porcentaje es una
 *  ayuda para calcularlos, lo que se guarda y lo que el banco descuenta son
 *  pesos. */
export type Montos = {
  retefuente: number;
  reteiva: number;
  reteica: number;
  otrosValor: number;
  otrosConcepto: string | null;
  observaciones: string | null;
};

export type ResultadoRetencion = {
  estado: string; retencion_ok: true;
  retefuente: string; reteiva: string; reteica: string;
  reten_total: string; valor_a_pagar: string;
  otros_valor: string; otros_concepto: string | null; observaciones: string | null;
};

/** Estados en los que la plata ya se movió (o está por moverse) y la retención
 *  deja de ser editable: cambiarla ahí dejaría el pago y el registro contable
 *  diciendo cosas distintas. */
export const ESTADOS_CERRADOS = ["aprobada_pago", "pagada", "causada"];

/** Escribe las retenciones de UNA factura dentro de la transacción que ya viene
 *  abierta, y deja el evento. Devuelve el parche para la UI.
 *
 *  `origen` distingue quién lo hizo en la bitácora: el modal ('web') o el Excel
 *  que subió el equipo ('excel'). Tres meses después, saber por dónde entró un
 *  número es la diferencia entre auditar y adivinar. */
export async function guardarRetenciones(
  c: PoolClient, cufe: string, m: Montos,
  actor: { email: string; rol: string }, origen: "web" | "excel" = "web",
): Promise<ResultadoRetencion> {
  const cur = await c.query<{
    estado: string; retefuente: string | null; reteiva: string | null;
    reteica: string | null; reten_total: string | null; total: string | null;
    retencion_ok: boolean;
  }>(
    `SELECT e.estado, e.retefuente, e.reteiva, e.reteica, e.reten_total,
            e.retencion_ok, f.total
       FROM factura_estado e JOIN facturas f USING (cufe)
      WHERE e.cufe = $1 FOR UPDATE`, [cufe]);
  if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
  const antes = cur.rows[0];

  if (ESTADOS_CERRADOS.includes(antes.estado)) {
    throw new Error("Las retenciones ya no se pueden editar en este estado.");
  }

  const retenTotal = m.retefuente + m.reteiva + m.reteica;
  const total = antes.total != null ? Number(antes.total) : 0;
  const valorAPagar = total - retenTotal - m.otrosValor;
  // Independiente de la clasificación: si aún no está clasificada, se guarda
  // igual (el semáforo se pone verde por retencion_ok) y el estado no se mueve.
  const nuevoEstado = antes.estado === "clasificada" ? "retenciones_ok" : antes.estado;

  await c.query(
    `UPDATE factura_estado
        SET retefuente = $2, reteiva = $3, reteica = $4,
            reten_total = $5, valor_a_pagar = $6,
            otros_valor = $8, otros_concepto = $9, observaciones = $10,
            retencion_ok = TRUE, estado = $7, actualizado_en = now()
      WHERE cufe = $1`,
    [cufe, m.retefuente, m.reteiva, m.reteica, retenTotal, valorAPagar,
     nuevoEstado, m.otrosValor, m.otrosConcepto, m.observaciones]);

  await registrarEvento(c, {
    cufe, tipo: "valida_retencion", campo: "retenciones",
    valorAnterior: {
      retefuente: antes.retefuente, reteiva: antes.reteiva, reteica: antes.reteica,
      reten_total: antes.reten_total, estado: antes.estado,
      ya_estaba_confirmada: antes.retencion_ok,
    },
    valorNuevo: {
      retefuente: m.retefuente, reteiva: m.reteiva, reteica: m.reteica,
      reten_total: retenTotal, valor_a_pagar: valorAPagar, estado: nuevoEstado,
      via: origen,
    },
    actor: actor.email, actorRol: actor.rol, origen: origen === "excel" ? "web" : origen,
  });

  return {
    estado: nuevoEstado, retencion_ok: true,
    retefuente: String(m.retefuente), reteiva: String(m.reteiva), reteica: String(m.reteica),
    reten_total: String(retenTotal), valor_a_pagar: String(valorAPagar),
    otros_valor: String(m.otrosValor), otros_concepto: m.otrosConcepto,
    observaciones: m.observaciones,
  };
}
