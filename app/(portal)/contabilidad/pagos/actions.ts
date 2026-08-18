"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { syncAbono } from "@/lib/abonos";
import type { PoolClient } from "pg";

// Tablero de pagos (3 columnas):
//   retenciones_ok  → PENDIENTES  (se asigna la cuenta propia por factura)
//   aprobada_pago   → VALIDACIÓN  (por cuenta; se baja el CSV del banco)
//   pagada          → CONFIRMADOS (el banco ya ejecutó)
// Cada movimiento deja su evento en la bitácora (append-only encadenada).

const done = () => revalidatePath("/contabilidad/pagos");
const cufesDe = (fd: FormData) => String(fd.get("cufes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function guardPagador() {
  return exigirCap("pagos");  // operar el tablero de pagos (asignar/confirmar/config)
}

/** Asigna la cuenta propia (Rappi/Davivienda/PSE) a las facturas seleccionadas y
 *  las pasa a 'aprobada_pago' (columna Validación). La cuenta se elige POR FACTURA;
 *  esta acción aplica la MISMA cuenta al lote seleccionado (se repite por cuenta si
 *  se quiere mezclar). Sólo mueve facturas listas para pago. */
export async function asignarCuenta(fd: FormData) {
  const user = await guardPagador();
  const cufes = cufesDe(fd);
  const cuenta = String(fd.get("cuenta") ?? "").trim();
  if (!cufes.length) throw new Error("Selecciona al menos una factura.");
  if (!cuenta) throw new Error("Elige la cuenta de pago.");
  await withTx(async (c: PoolClient) => {
    const cc = await c.query("SELECT 1 FROM cuentas_pago WHERE nombre = $1 AND activo", [cuenta]);
    if (!cc.rowCount) throw new Error("Cuenta de pago no válida: " + cuenta);
    const { rows } = await c.query<{ cufe: string; estado: string }>(
      "SELECT cufe, estado FROM factura_estado WHERE cufe = ANY($1) FOR UPDATE", [cufes]);
    for (const r of rows) {
      if (!["retenciones_ok", "aprobada_pago"].includes(r.estado)) {
        throw new Error(`La factura ${r.cufe} no está lista para pago (clasifica y retén primero).`);
      }
    }
    await c.query(
      `UPDATE factura_estado SET cuenta_pago = $2, estado = 'aprobada_pago', actualizado_en = now()
        WHERE cufe = ANY($1) AND estado IN ('retenciones_ok','aprobada_pago')`,
      [cufes, cuenta]);
    await registrarEvento(c, {
      cufe: null, tipo: "asigna_cuenta", campo: "cuenta_pago",
      valorNuevo: { cuenta, facturas: cufes.length },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  done();
}

/** Devuelve facturas a PENDIENTES: quita la cuenta y vuelve a 'retenciones_ok'.
 *  Sólo si aún no se ha registrado pago (no tocar lo ya pagado). */
export async function quitarCuenta(fd: FormData) {
  const user = await guardPagador();
  const cufes = cufesDe(fd);
  if (!cufes.length) throw new Error("Selecciona al menos una factura.");
  await withTx(async (c) => {
    await c.query(
      `UPDATE factura_estado SET cuenta_pago = NULL, estado = 'retenciones_ok', actualizado_en = now()
        WHERE cufe = ANY($1) AND estado = 'aprobada_pago' AND coalesce(pago_estado,'pendiente') <> 'pagado'`,
      [cufes]);
    await registrarEvento(c, {
      cufe: null, tipo: "quita_cuenta", campo: "cuenta_pago",
      valorNuevo: { facturas: cufes.length },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  done();
}

/** Confirma el pago (el banco ya ejecutó) de facturas de un MISMO proveedor y
 *  MISMA cuenta. Registra un `pagos` (con la cuenta), aplica a las facturas
 *  (abono si monto < saldo, más antiguas primero); las saldadas → 'pagada'
 *  (columna Confirmados), las parciales se quedan en Validación con su saldo. */
export async function confirmarPago(fd: FormData) {
  const user = await guardPagador();
  const cufes = cufesDe(fd);
  if (!cufes.length) throw new Error("Selecciona al menos una factura.");
  const fecha = String(fd.get("fecha_pago") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const comprobante = String(fd.get("comprobante_url") ?? "").trim() || null;
  const nota = String(fd.get("nota") ?? "").trim() || null;
  const montoRaw = String(fd.get("monto") ?? "").replace(/[^\d.-]/g, "");

  await withTx(async (c: PoolClient) => {
    const { rows } = await c.query<{
      cufe: string; nit_proveedor: string; nombre_proveedor: string | null;
      estado: string; cuenta_pago: string | null; a_pagar: string; pagado: string; abono: string;
    }>(
      `SELECT e.cufe, f.nit_proveedor, f.nombre_proveedor, e.estado, e.cuenta_pago,
              coalesce(e.valor_a_pagar, f.total) AS a_pagar, coalesce(e.pago_monto,0) AS pagado,
              coalesce(e.abono_aplicado,0) AS abono
         FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE e.cufe = ANY($1) ORDER BY f.fecha_emision FOR UPDATE`, [cufes]);
    if (!rows.length) throw new Error("Facturas no encontradas.");

    const nit = rows[0].nit_proveedor;
    const cuenta = rows[0].cuenta_pago;
    if (rows.some((r) => r.nit_proveedor !== nit)) throw new Error("Un pago cubre facturas de un solo proveedor.");
    if (rows.some((r) => (r.cuenta_pago ?? null) !== (cuenta ?? null))) throw new Error("Todas las facturas deben tener la misma cuenta de pago.");
    for (const r of rows) {
      if (r.estado !== "aprobada_pago") throw new Error(`La factura ${r.cufe} no está en Validación.`);
    }

    const saldos = rows.map((r) => {
      const aPagar = Number(r.a_pagar), pagado = Number(r.pagado), abono = Number(r.abono);
      return { cufe: r.cufe, aPagar, pagado, saldo: Math.max(0, aPagar - pagado - abono) };
    });
    const totalSaldo = saldos.reduce((s, x) => s + x.saldo, 0);
    const monto = montoRaw === "" ? totalSaldo : Number(montoRaw);
    if (!Number.isFinite(monto) || monto <= 0) throw new Error("Monto inválido.");
    if (monto > totalSaldo + 1) throw new Error("El monto supera el saldo pendiente del proveedor.");
    const tipo = monto >= totalSaldo - 1 ? "completo" : "abono";

    const pago = await c.query<{ id: number }>(
      `INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, comprobante_url, nota, pagado_por, cuenta_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [nit, fecha, monto, tipo, comprobante, nota, user.email, cuenta]);
    const pagoId = pago.rows[0].id;

    let restante = monto;
    for (const s of saldos) {                        // más antiguas primero
      if (restante <= 0 || s.saldo <= 0) continue;
      const aplica = Math.min(restante, s.saldo);
      restante -= aplica;
      const nuevoPagado = s.pagado + aplica;
      const saldado = nuevoPagado >= s.aPagar - 1;   // tolerancia de $1 por redondeo
      await c.query("INSERT INTO pago_facturas (pago_id, cufe, monto_aplicado) VALUES ($1,$2,$3)", [pagoId, s.cufe, aplica]);
      await c.query(
        `UPDATE factura_estado SET pago_monto = $2, pago_estado = $3, pago_tipo = $4, fecha_pago = $5,
                estado = $6, actualizado_en = now() WHERE cufe = $1`,
        [s.cufe, nuevoPagado, saldado ? "pagado" : "parcial", tipo, fecha, saldado ? "pagada" : "aprobada_pago"]);
    }

    await registrarEvento(c, {
      cufe: null, tipo: "confirma_pago", campo: "pago",
      valorNuevo: { proveedor: rows[0].nombre_proveedor, nit, cuenta, monto, tipo, facturas: cufes.length, comprobante: !!comprobante, fecha },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  done();
}

/** "Pasar a otra semana": cambia la semana de pago PROGRAMADA (no toca el
 *  vencimiento real). Aplica en Pendientes. */
export async function reprogramarSemana(fd: FormData) {
  const user = await guardPagador();
  const cufes = cufesDe(fd);
  const fecha = String(fd.get("fecha") ?? "").trim();
  if (!cufes.length || !fecha) throw new Error("Falta selección o fecha.");
  await withTx(async (c) => {
    await c.query("UPDATE factura_estado SET fecha_pago_prog = $2, actualizado_en = now() WHERE cufe = ANY($1)", [cufes, fecha]);
    await registrarEvento(c, { cufe: null, tipo: "reprograma_pago", campo: "semana", valorNuevo: { facturas: cufes.length, fecha }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}

// ---------------------------------------------------------------------------
// BLOQUE "SIN FACTURA DIAN": cuentas de cobro y adelantos de cotización.
//
// Es plata que sale por la misma tubería (cuenta propia → archivo del banco →
// Historial) pero NO tiene factura electrónica. Vive aparte de `facturas` a
// propósito: meterla ahí obligaría a inventarle un CUFE, y esa tabla es el
// espejo de la identidad DIAN.
// ---------------------------------------------------------------------------

type TipoIntake = "cuenta_cobro" | "cotizacion";

/** El tipo elige TABLA: se valida contra una lista cerrada, nunca se concatena
 *  lo que mande el cliente. */
function tipoIntake(v: FormDataEntryValue | null): TipoIntake {
  const t = String(v ?? "");
  if (t !== "cuenta_cobro" && t !== "cotizacion") throw new Error("Tipo de solicitud inválido.");
  return t;
}
const TABLA: Record<TipoIntake, string> = { cuenta_cobro: "cuentas_cobro", cotizacion: "cotizaciones" };

/** Asigna la cuenta propia desde la que se pagará una solicitud del intake
 *  (equivale a `asignarCuenta` de las facturas: es lo que la mete en el CSV de
 *  esa cuenta). */
export async function asignarCuentaIntake(fd: FormData) {
  const user = await guardPagador();
  const tipo = tipoIntake(fd.get("tipo"));
  const id = Number(fd.get("id"));
  const cuenta = String(fd.get("cuenta") ?? "").trim();
  if (!id) throw new Error("Falta la solicitud.");
  await withTx(async (c) => {
    if (cuenta) {
      const cc = await c.query("SELECT 1 FROM cuentas_pago WHERE nombre = $1 AND activo", [cuenta]);
      if (!cc.rowCount) throw new Error("Cuenta de pago no válida: " + cuenta);
    }
    const r = await c.query(
      `UPDATE ${TABLA[tipo]} SET cuenta_pago = $2 WHERE id = $1 AND pago_id IS NULL`,
      [id, cuenta || null]);
    if (!r.rowCount) throw new Error("La solicitud ya está pagada o no existe.");
    await registrarEvento(c, {
      cufe: null, tipo: "asigna_cuenta_intake", campo: "cuenta_pago",
      valorNuevo: { tipo, id, cuenta: cuenta || null },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  done();
}

/** Confirma el pago de una solicitud del intake (el banco ya ejecutó).
 *
 *  Crea el `pagos` — con `origen` para que el Historial no lo confunda con una
 *  factura — y cierra el envío. En una COTIZACIÓN además registra el abono: es
 *  lo que hace que, cuando llegue la factura final y se enlace, Pagos le
 *  descuente el adelanto. Sin ese registro se pagaría dos veces. */
export async function confirmarPagoIntake(fd: FormData) {
  const user = await guardPagador();
  const tipo = tipoIntake(fd.get("tipo"));
  const id = Number(fd.get("id"));
  if (!id) throw new Error("Falta la solicitud.");
  const fecha = String(fd.get("fecha_pago") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const comprobante = String(fd.get("comprobante_url") ?? "").trim() || null;
  const nota = String(fd.get("nota") ?? "").trim() || null;
  const montoRaw = String(fd.get("monto") ?? "").replace(/[^\d.-]/g, "");

  await withTx(async (c: PoolClient) => {
    const q = tipo === "cuenta_cobro"
      ? `SELECT id, razon_social AS nombre, num_doc AS nit, estado, cuenta_pago, pago_id,
                coalesce(valor,0) AS debido, 'CC-' || id AS ref
           FROM cuentas_cobro WHERE id = $1 FOR UPDATE`
      : `SELECT id, razon_social AS nombre, nit, estado, cuenta_pago, pago_id,
                round(coalesce(valor,0) * coalesce(adelanto_pct,0) / 100) AS debido,
                coalesce(codigo, 'COT-' || id) AS ref
           FROM cotizaciones WHERE id = $1 FOR UPDATE`;
    const { rows } = await c.query<{
      id: number; nombre: string; nit: string; estado: string;
      cuenta_pago: string | null; pago_id: number | null; debido: string; ref: string;
    }>(q, [id]);
    const s = rows[0];
    if (!s) throw new Error("Solicitud no encontrada.");
    if (s.pago_id) throw new Error("Esta solicitud ya tiene un pago registrado.");
    const estadosOk = tipo === "cuenta_cobro" ? ["aprobada"] : ["aprobada", "facturada"];
    if (!estadosOk.includes(s.estado)) throw new Error("La solicitud no está aprobada.");
    if (!s.cuenta_pago) throw new Error("Elige primero la cuenta desde la que se paga.");

    const debido = Number(s.debido);
    const monto = montoRaw === "" ? debido : Number(montoRaw);
    if (!Number.isFinite(monto) || monto <= 0) throw new Error("Monto inválido.");
    if (debido > 0 && monto > debido + 1) throw new Error("El monto supera lo aprobado para esta solicitud.");

    const pago = await c.query<{ id: number }>(
      `INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, comprobante_url, nota,
                          pagado_por, cuenta_pago, origen, origen_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [s.nit, fecha, monto, tipo === "cotizacion" ? "adelanto" : "completo",
       comprobante, nota, user.email, s.cuenta_pago, tipo, s.ref]);
    const pagoId = pago.rows[0].id;

    if (tipo === "cuenta_cobro") {
      await c.query("UPDATE cuentas_cobro SET estado = 'pagada', pago_id = $2 WHERE id = $1", [id, pagoId]);
    } else {
      await c.query("UPDATE cotizaciones SET pago_id = $2 WHERE id = $1", [id, pagoId]);
      // EL CRUCE: el adelanto queda como abono de la cotización para que la
      // factura final se pague por el SALDO, no por el total.
      await c.query(
        `INSERT INTO cotizacion_abonos (cotizacion_id, monto, fecha, cuenta_pago, comprobante_url, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, monto, fecha, s.cuenta_pago, comprobante, user.email]);
      await syncAbono(c, id);
    }

    await registrarEvento(c, {
      cufe: null, tipo: "confirma_pago_intake", campo: "pago",
      valorNuevo: { origen: tipo, ref: s.ref, proveedor: s.nombre, nit: s.nit,
                    cuenta: s.cuenta_pago, monto, fecha, comprobante: !!comprobante, pago_id: pagoId },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  done();
  revalidatePath(tipo === "cuenta_cobro" ? "/contabilidad/cuentas-de-cobro" : "/contabilidad/cotizaciones");
}

// ---------- Configuración de Pagos (cuentas propias + día de pago) ----------

/** Agrega/reactiva una cuenta propia de pago. `formato` define la plantilla del
 *  CSV del banco (rappi | davivienda | pse | generico). */
export async function agregarCuentaPago(fd: FormData) {
  const user = await guardPagador();
  const nombre = String(fd.get("nombre") ?? "").trim();
  const formato = String(fd.get("formato") ?? "generico").trim() || "generico";
  if (!nombre) throw new Error("Falta el nombre de la cuenta.");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO cuentas_pago (nombre, formato, creado_por, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (nombre) DO UPDATE SET formato = EXCLUDED.formato, activo = TRUE`,
      [nombre, formato, user.email]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "cuenta_pago", valorNuevo: { nombre, formato }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}

/** Activa/desactiva una cuenta propia de pago (no borra). */
export async function toggleCuentaPago(fd: FormData) {
  await guardPagador();
  const nombre = String(fd.get("nombre") ?? "").trim();
  if (!nombre) throw new Error("Falta la cuenta.");
  await withTx(async (c) => {
    await c.query("UPDATE cuentas_pago SET activo = NOT activo WHERE nombre = $1", [nombre]);
  });
  done();
}

/** Define el día de pago (ISO 1=Lun..7=Dom): la fecha de pago SUGERIDA de cada
 *  factura se alinea a ese día (último día de pago ≤ vencimiento). */
export async function guardarDiaPago(fd: FormData) {
  const user = await guardPagador();
  const dia = String(fd.get("dia_pago") ?? "").trim();
  if (!/^[1-7]$/.test(dia)) throw new Error("Día de pago inválido.");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO config_pagos (clave, valor) VALUES ('dia_pago',$1)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [dia]);
    await registrarEvento(c, { cufe: null, tipo: "config", campo: "dia_pago", valorNuevo: { dia }, actor: user.email, actorRol: user.rol, origen: "web" });
  });
  done();
}
