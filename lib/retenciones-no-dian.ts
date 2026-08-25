// RETENCIONES DE LO QUE NO TIENE FACTURA DIAN — un solo camino de escritura.
//
// Hermano de `lib/retenciones.ts` (que escribe las de las facturas). Vive aparte
// porque los datos viven en otra tabla (`cuentas_cobro`, sin CUFE), pero por la
// misma razón que aquél existe: son DOS las puertas que escriben esto —el modal
// de la fila y el Excel que suben los contadores— y dos caminos que guardan lo
// mismo terminan haciendo cosas distintas. Pasó con el candado de aprobación.

import { registrarEvento } from "@/lib/eventos";
import type { PoolClient } from "pg";

// La llave de ida y vuelta vive en su propio módulo PURO (lib/ref-documento.ts):
// la usan también la bandeja y el exportador, y así se puede probar sin base.
export { refDe, esRefNoDian, idDeRef } from "@/lib/ref-documento";

export type RetencionesNoDian = {
  retefuente: number;
  reteiva: number;
  reteica: number;
  /** Solo lo escribe el modal; el Excel no trae esta columna y no la toca. */
  ivaIncluido?: number | null;
  otrosValor: number;
  otrosConcepto: string | null;
  observaciones: string | null;
};

/** Escribe las retenciones de una cuenta de cobro / gasto sin factura.
 *
 *  Devuelve el valor a pagar resultante. Lanza —con el motivo escrito para el
 *  humano— si el documento ya se pagó o si las cifras no cierran. */
export async function guardarRetencionesNoDian(
  c: PoolClient, id: number, r: RetencionesNoDian,
  actor: { email: string; rol: string }, origen: "web" | "excel",
): Promise<number> {
  const { rows } = await c.query<{ valor: string | null; iva_incluido: string | null; pago_id: number | null }>(
    "SELECT valor, iva_incluido, pago_id FROM cuentas_cobro WHERE id = $1 FOR UPDATE", [id]);
  const cc = rows[0];
  if (!cc) throw new Error("Documento no encontrado.");
  if (cc.pago_id) throw new Error("Ya está pagado: las retenciones no se pueden cambiar.");

  const valor = Number(cc.valor ?? 0);
  if (valor <= 0) throw new Error("El documento no tiene valor.");
  // El IVA incluido solo viaja por el modal. Si no viene, se conserva el que
  // había: lo que no está en el archivo no puede borrarse por venir de vuelta.
  const iva = r.ivaIncluido ?? Number(cc.iva_incluido ?? 0);
  if (iva > valor) throw new Error("El IVA incluido no puede ser mayor que el valor.");

  const retenTotal = r.retefuente + r.reteiva + r.reteica;
  const valorAPagar = valor - retenTotal - r.otrosValor;
  // Retener más de lo que vale el cobro es siempre un error de digitación.
  if (valorAPagar <= 0) {
    throw new Error("Las retenciones y descuentos se comen todo el valor. Revisa las cifras.");
  }

  await c.query(
    `UPDATE cuentas_cobro
        SET iva_incluido = $2, retefuente = $3, reteiva = $4, reteica = $5,
            reten_total = $6, otros_valor = $7, otros_concepto = $8,
            valor_a_pagar = $9, observaciones = $10, retencion_ok = TRUE,
            retenciones_por = $11, retenciones_en = now()
      WHERE id = $1`,
    [id, iva, r.retefuente, r.reteiva, r.reteica, retenTotal, r.otrosValor, r.otrosConcepto,
     valorAPagar, r.observaciones, actor.email]);

  await registrarEvento(c, {
    cufe: null, tipo: "retenciones_cuenta_cobro", campo: "valor_a_pagar",
    valorAnterior: { valor },
    valorNuevo: { id, retefuente: r.retefuente, reteiva: r.reteiva, reteica: r.reteica,
                  otros: r.otrosValor, valor_a_pagar: valorAPagar, por: origen },
    actor: actor.email, actorRol: actor.rol, origen: "web",
  });
  return valorAPagar;
}
