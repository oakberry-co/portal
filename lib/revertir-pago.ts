// REVERTIR UN PAGO QUE NUNCA SALIÓ DEL BANCO.
//
// El portal aprendió a no devolver una factura pagada (30-ago-2026): una pagada
// que retrocede reaparece en Pagos, alguien le asigna cuenta y se paga DOS
// VECES. Esa regla sigue. Esto es su excepción controlada, y nació de un caso
// real: la migración del Sheet (11-ago) convirtió en pagos del portal 265 marcas
// «Pagado» tecleadas a mano, sin comprobante, y una estaba mal —VIB125646,
// $13,9 M— con lo que el portal la daba por pagada y nadie encontraba el giro.
//
// Cómo se protege de sí mismo:
//   · Solo se revierte un pago SIN comprobante, de UNA factura y COMPLETO. Con
//     comprobante la plata salió; con varias facturas o un abono, deshacer una
//     sola deja el pago descuadrado. Todo eso es ajuste con el contador, no clic.
//   · El motivo es obligatorio y hay que declarar que se miró el BANCO, no el
//     portal: el portal es justamente lo que estaba mal.
//   · No se borra: el pago se copia entero a `pagos_revertidos` y recién ahí se
//     saca de `pagos`, para que tablero, Historial y Excel dejen de verlo sin
//     que a ninguna consulta le falte un filtro (así se rompe: una envejece).
//   · La factura vuelve al paso que le corresponde por lo que YA tiene —concepto,
//     destino, plazo, retenciones—, no a «capturada» a ciegas: lo confirmado por
//     un humano sigue valiendo. Desde ahí pasa por el flujo normal hasta Pagos.
//   · Queda el evento `revierte_pago` en la bitácora encadenada, con el pago
//     entero adentro.
//
// Los imports son RELATIVOS (no "@/") a propósito: el centinela compila este
// módulo con `tsc` suelto y lo corre contra la base real con ROLLBACK.

import type { PoolClient } from "pg";
import { registrarEvento } from "./eventos";

export type PagoActivo = {
  id: number; nit_proveedor: string; fecha_pago: string; monto: number; tipo: string;
  cuenta_pago: string | null; comprobante_url: string | null; nota: string | null;
  pagado_por: string; creado_en: string; origen: string | null; n_facturas: number;
};

/** Lo que la pantalla necesita para decidir si ofrece el botón y qué decir si no. */
export type Revertible = {
  pago: PagoActivo | null;
  /** cuántos pagos distintos tocan esta factura (abonos) */
  n_pagos: number;
  puede: boolean;
  /** por qué NO (Regla 18: un «no se puede» sin motivo hace que dejen de usar el portal) */
  motivoNo: string | null;
  /** el pago vino de la migración del Sheet: no lo hizo nadie desde el portal */
  migrado: boolean;
};

export const MIN_MOTIVO = 10;

/** ¿El pago vino de la migración del Sheet histórico? Ese actor no es una
 *  persona: es la marca «Pagado» del Sheet convertida en pago. */
export const esPagoMigrado = (pagadoPor: string | null | undefined): boolean =>
  !!pagadoPor && pagadoPor.startsWith("migracion:");

/** A qué paso vuelve la factura al quitarle el pago. La MISMA regla con la que
 *  `guardarClasificacion` avanza: con concepto + destino + plazo está
 *  clasificada, y si además las retenciones están confirmadas ya puede ir a
 *  Pagos. Lo que un humano confirmó no se pierde por revertir un pago. */
export function estadoPrevioAlPago(e: {
  concepto: string | null; destino: string | null; plazo_dias: number | null; retencion_ok: boolean;
}): "capturada" | "clasificada" | "retenciones_ok" {
  const completa = !!e.concepto && !!e.destino && e.plazo_dias != null;
  if (!completa) return "capturada";
  return e.retencion_ok ? "retenciones_ok" : "clasificada";
}

/** El pago que hoy respalda el «pagada» de esta factura, y si se puede deshacer. */
export async function pagoActivoDe(c: PoolClient, cufe: string): Promise<Revertible> {
  const { rows } = await c.query<PagoActivo>(
    `SELECT p.id, p.nit_proveedor, p.fecha_pago::text AS fecha_pago, p.monto::float AS monto,
            p.tipo, p.cuenta_pago, p.comprobante_url, p.nota, p.pagado_por,
            p.creado_en::text AS creado_en, p.origen,
            (SELECT count(*)::int FROM pago_facturas x WHERE x.pago_id = p.id) AS n_facturas
       FROM pago_facturas pf JOIN pagos p ON p.id = pf.pago_id
      WHERE pf.cufe = $1
      ORDER BY p.id DESC`, [cufe]);
  const no = (motivoNo: string, pago: PagoActivo | null = rows[0] ?? null): Revertible =>
    ({ pago, n_pagos: rows.length, puede: false, motivoNo, migrado: esPagoMigrado(pago?.pagado_por) });

  if (rows.length === 0) return no("Esta factura no tiene ningún pago registrado: no hay nada que revertir.", null);
  if (rows.length > 1) {
    return no(`Esta factura tiene ${rows.length} pagos (abonos). Revertir abonos no se hace desde acá: es un ajuste con el contador.`);
  }
  const p = rows[0];
  if (p.comprobante_url) {
    return no("Este pago tiene comprobante subido: la plata salió. Si de verdad no salió, es un ajuste con el contador, no un clic.");
  }
  if (p.n_facturas > 1) {
    return no(`Este pago cubrió ${p.n_facturas} facturas a la vez. Deshacer una sola dejaría el pago descuadrado: es un ajuste con el contador.`);
  }
  if (p.origen && p.origen !== "factura") {
    return no("Este pago no es de una factura DIAN (cuenta de cobro o adelanto): se revisa desde su bandeja.");
  }
  if (p.tipo !== "completo") {
    return no("Este pago es un abono, no un pago completo. Revertir abonos es un ajuste con el contador.");
  }
  return { pago: p, n_pagos: 1, puede: true, motivoNo: null, migrado: esPagoMigrado(p.pagado_por) };
}

export type ResultadoReversion = {
  estado: "capturada" | "clasificada" | "retenciones_ok";
  pago_estado: "pendiente";
  rev_motivo: string; rev_por: string; rev_en: string;
};

/** Deshace el pago de UNA factura dentro de la transacción que ya viene abierta.
 *  Lanza con un mensaje escrito para el humano si no se puede. */
export async function revertirPago(
  c: PoolClient, cufe: string,
  datos: { motivo: string; verificadoBanco: boolean },
  actor: { email: string; rol: string }, origen: "web" | "pipeline" = "web",
): Promise<ResultadoReversion> {
  const motivo = (datos.motivo ?? "").trim();
  if (motivo.length < MIN_MOTIVO) {
    throw new Error("Escribe el motivo: qué revisaron y dónde (extracto, fecha, con quién). Queda en la bitácora.");
  }
  if (!datos.verificadoBanco) {
    throw new Error("Marca que verificaron EN EL BANCO que esta plata no salió. El portal es justamente lo que estaba mal.");
  }

  const cur = await c.query<{
    estado: string; concepto: string | null; destino: string | null; plazo_dias: number | null;
    retencion_ok: boolean; pago_estado: string; pago_tipo: string | null; pago_monto: string | null;
    fecha_pago: string | null; cuenta_pago: string | null; aprobado_pago_por: string | null;
    aprobado_pago_en: string | null; numero: string;
  }>(
    `SELECT e.estado, e.concepto, e.destino, e.plazo_dias, e.retencion_ok, e.pago_estado,
            e.pago_tipo, e.pago_monto::text AS pago_monto, e.fecha_pago::text AS fecha_pago,
            e.cuenta_pago, e.aprobado_pago_por, e.aprobado_pago_en::text AS aprobado_pago_en,
            f.numero
       FROM factura_estado e JOIN facturas f USING (cufe)
      WHERE e.cufe = $1 FOR UPDATE`, [cufe]);
  if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
  const e = cur.rows[0];

  const r = await pagoActivoDe(c, cufe);
  if (!r.puede || !r.pago) throw new Error(r.motivoNo ?? "Este pago no se puede revertir.");
  const pago = r.pago;
  // Bloquear el pago también: dos personas revirtiendo lo mismo a la vez es
  // exactamente el tipo de carrera que un camino de dinero no puede permitirse.
  await c.query("SELECT 1 FROM pagos WHERE id = $1 FOR UPDATE", [pago.id]);

  const estadoAnterior = {
    estado: e.estado, pago_estado: e.pago_estado, pago_tipo: e.pago_tipo, pago_monto: e.pago_monto,
    fecha_pago: e.fecha_pago, cuenta_pago: e.cuenta_pago,
    aprobado_pago_por: e.aprobado_pago_por, aprobado_pago_en: e.aprobado_pago_en,
  };

  // 1) Copia entera del pago, ANTES de tocarlo. Si esto falla, no se borra nada.
  const rev = await c.query<{ id: number; revertido_en: string }>(
    `INSERT INTO pagos_revertidos
       (pago_id, cufe, nit_proveedor, fecha_pago, monto, tipo, cuenta_pago, comprobante_url,
        nota, pagado_por, pago_creado_en, origen, facturas, estado_anterior, motivo,
        verificado_banco, revertido_por)
     SELECT p.id, $2, p.nit_proveedor, p.fecha_pago, p.monto, p.tipo, p.cuenta_pago, p.comprobante_url,
            p.nota, p.pagado_por, p.creado_en, p.origen,
            coalesce((SELECT json_agg(json_build_object('cufe', x.cufe, 'monto_aplicado', x.monto_aplicado))
                        FROM pago_facturas x WHERE x.pago_id = p.id), '[]'::json),
            $3::jsonb, $4, TRUE, $5
       FROM pagos p WHERE p.id = $1
     RETURNING id, revertido_en::text AS revertido_en`,
    [pago.id, cufe, JSON.stringify(estadoAnterior), motivo, actor.email]);
  if (rev.rowCount !== 1) throw new Error("No se pudo guardar la copia del pago; no se revirtió nada.");

  // 2) Recién ahora sale de `pagos`. El CASCADE se lleva pago_facturas.
  const del = await c.query("DELETE FROM pagos WHERE id = $1", [pago.id]);
  if (del.rowCount !== 1) throw new Error("El pago ya no estaba: alguien lo revirtió al mismo tiempo.");

  // 3) La factura vuelve al paso que le toca por lo que ya tiene confirmado.
  const nuevoEstado = estadoPrevioAlPago(e);
  await c.query(
    `UPDATE factura_estado
        SET estado = $2, pago_estado = 'pendiente', pago_tipo = NULL, pago_monto = NULL,
            fecha_pago = NULL, cuenta_pago = NULL, aprobado_pago_por = NULL, aprobado_pago_en = NULL,
            actualizado_en = now()
      WHERE cufe = $1`, [cufe, nuevoEstado]);

  await registrarEvento(c, {
    cufe, tipo: "revierte_pago", campo: "pago",
    valorAnterior: { ...estadoAnterior, pago: { ...pago, cufe } },
    valorNuevo: {
      estado: nuevoEstado, pago_estado: "pendiente", motivo, verificado_banco: true,
      migrado: r.migrado, factura: e.numero, pagos_revertidos_id: rev.rows[0].id,
    },
    actor: actor.email, actorRol: actor.rol, origen,
  });

  return {
    estado: nuevoEstado, pago_estado: "pendiente",
    rev_motivo: motivo, rev_por: actor.email, rev_en: rev.rows[0].revertido_en,
  };
}
