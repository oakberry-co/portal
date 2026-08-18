import type { PoolClient } from "pg";

/** Recalcula el abono aplicado a la factura enlazada de una cotización.
 *
 *  EL CRUCE ANTI-DOBLE-PAGO: lo que ya se adelantó contra la cotización tiene
 *  que descontarse del saldo de la factura final. Se recalcula desde la suma de
 *  `cotizacion_abonos` (no se acumula) para que borrar o corregir un abono deje
 *  el saldo correcto — sumar en el momento sería una segunda fuente de verdad
 *  que se desincroniza al primer ajuste.
 *
 *  Vive en un módulo plano (no "use server") porque lo necesitan tanto la
 *  bandeja de cotizaciones como el tablero de Pagos, y un abono registrado en un
 *  lado y no en el otro es exactamente lo que hace pagar dos veces. */
export async function syncAbono(c: PoolClient, cotId: number): Promise<void> {
  const r = await c.query<{ cufe: string | null; abono: string }>(
    `SELECT cufe_factura AS cufe,
            coalesce((SELECT sum(monto) FROM cotizacion_abonos WHERE cotizacion_id = $1),0) AS abono
       FROM cotizaciones WHERE id = $1`, [cotId]);
  const cufe = r.rows[0]?.cufe;
  if (cufe) {
    await c.query("UPDATE factura_estado SET abono_aplicado = $2, actualizado_en = now() WHERE cufe = $1",
      [cufe, Number(r.rows[0].abono)]);
  }
}
