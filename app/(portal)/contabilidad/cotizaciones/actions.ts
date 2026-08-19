"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { docsFaltantes, type DocGuardado } from "@/lib/areas";
import { bloqueoAprobacion, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { syncAbono } from "@/lib/abonos";
import { aplicarCuentaCertificada } from "@/lib/cuenta-certificada";
import { encolarCorreo } from "@/lib/correos";
import type { PoolClient } from "pg";

async function guard() {
  return exigirCap("intake");
}
const done = () => {
  revalidatePath("/contabilidad/cotizaciones");
  revalidatePath("/contabilidad/pagos");
};

const ESTADOS: Record<string, string> = {
  aprobar: "aprobada", rechazar: "rechazada", cerrar: "cerrada", reabrir: "recibida",
};

/** Los mismos candados que en cuentas de cobro, re-evaluados CONTRA LA BASE al
 *  aprobar (la bandeja los muestra, pero decide el servidor), más el que es
 *  propio de este módulo: sin adelanto no hay nada que llevar a Pagos — una
 *  cotización sin anticipo se paga por su factura, que ya tiene su carril. */
async function exigirAprobable(c: PoolClient, id: number): Promise<Aprobable> {
  const { rows } = await c.query<Aprobable & {
    documentos: DocGuardado[]; cert: CertEstado | null; cuenta: CuentaMaestro;
    valor: string | null; adelanto_pct: string | null; requiere_adelanto: boolean;
  }>(
    `SELECT cot.documentos, cot.valor, cot.adelanto_pct, cot.requiere_adelanto,
            cot.razon_social, cot.correo, cot.codigo, cot.plazo_dias,
            to_jsonb(cert) AS cert, to_jsonb(cb) AS cuenta
       FROM cotizaciones cot
       LEFT JOIN LATERAL (
         SELECT x.id, x.estado, x.motivo, x.banco, x.num_cuenta, x.aplicada,
                x.cuenta_anterior, x.leido_en::text AS leido_en
           FROM certificacion_bancaria x
          WHERE x.origen_tipo = 'cotizacion' AND x.origen_id = cot.id
          ORDER BY x.id DESC LIMIT 1) cert ON TRUE
       LEFT JOIN LATERAL (
         SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
           FROM cuentas_bancarias_proveedor y WHERE y.nit = cot.nit) cb ON TRUE
      WHERE cot.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new Error("Cotización no encontrada.");
  const bloqueo = bloqueoAprobacion(docsFaltantes(r.documentos), r.cert, r.cuenta);
  if (bloqueo) throw new Error(bloqueo);
  if (!r.requiere_adelanto || !Number(r.adelanto_pct ?? 0) || !Number(r.valor ?? 0)) {
    throw new Error("Esta cotización no tiene adelanto (valor y %) — no hay monto que pasar a Pagos. "
                  + "Sin anticipo el trámite es la factura del proveedor.");
  }
  return { ...r, certId: r.cert!.id,
           adelanto: Math.round(Number(r.valor) * Number(r.adelanto_pct) / 100) };
}

/** Lo que hace falta para aprobar Y para escribirle al proveedor. */
type Aprobable = {
  razon_social: string; correo: string | null; codigo: string | null;
  valor: string | null; adelanto_pct: string | null; plazo_dias: number | null;
  certId: number; adelanto: number;
};

export async function revisarCotizacion(fd: FormData) {
  const user = await guard();
  const id = Number(fd.get("id"));
  const accion = String(fd.get("accion") ?? "");
  const nuevo = ESTADOS[accion];
  const nota = String(fd.get("nota") ?? "").trim() || null;
  if (!id || !nuevo) throw new Error("Acción inválida.");
  await withTx(async (c) => {
    if (accion === "aprobar") {
      // Igual que en cuentas de cobro: aprobar escribe la cuenta certificada en
      // el maestro, en la misma transacción.
      const ap = await exigirAprobable(c, id);
      await aplicarCuentaCertificada(c, ap.certId, user);
      await encolarCorreo(c, {
        tipo: "aprobacion", origenTipo: "cotizacion", origenId: id,
        para: ap.correo, actor: user.email,
        datos: { ref: ap.codigo ?? `COT-${id}`, proveedor: ap.razon_social,
                 valor: Number(ap.valor), adelanto: ap.adelanto,
                 adelanto_pct: Number(ap.adelanto_pct), plazo_dias: ap.plazo_dias },
      });
    }
    if (accion === "rechazar") {
      // Igual que en cuentas de cobro: devolver sin avisar deja al proveedor
      // esperando, y sin motivo no sabe qué corregir.
      if (!nota) throw new Error("Escribe por qué la devuelves: el proveedor lo va a leer.");
      const { rows } = await c.query<{ correo: string | null; razon_social: string;
                                       codigo: string | null; token: string | null }>(
        "SELECT correo, razon_social, codigo, token FROM cotizaciones WHERE id = $1", [id]);
      await encolarCorreo(c, {
        tipo: "rechazo", origenTipo: "cotizacion", origenId: id,
        para: rows[0]?.correo ?? null, actor: user.email,
        datos: { ref: rows[0]?.codigo ?? `COT-${id}`, proveedor: rows[0]?.razon_social,
                 motivo: nota, token: rows[0]?.token },
      });
    }
    if (accion === "reabrir") {
      const { rows } = await c.query<{ pago_id: number | null }>(
        "SELECT pago_id FROM cotizaciones WHERE id = $1", [id]);
      if (rows[0]?.pago_id) throw new Error("Esta cotización ya tiene el adelanto pagado: no se puede devolver a revisión.");
    }
    await c.query(
      `UPDATE cotizaciones
          SET estado = $2, nota_revision = COALESCE($3, nota_revision),
              -- volver a la bandeja la saca del tablero de Pagos
              cuenta_pago = CASE WHEN $2 = 'recibida' THEN NULL ELSE cuenta_pago END,
              revisado_por = $4, revisado_en = now(),
              aprobado_en = CASE WHEN $2 = 'aprobada' THEN now() ELSE aprobado_en END,
              -- El adelanto se paga YA: es la condición para que el proveedor
              -- arranque. La fecha queda explícita para que el tablero lo ordene
              -- junto a las facturas y no dependa de cuándo llegó la cotización.
              fecha_pago_prog = CASE WHEN $2 = 'aprobada'
                THEN COALESCE(fecha_pago_prog, (now() AT TIME ZONE 'America/Bogota')::date)
                ELSE fecha_pago_prog END
        WHERE id = $1`,
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
