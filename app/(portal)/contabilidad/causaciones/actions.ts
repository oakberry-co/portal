"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { intentar, type Resultado } from "@/lib/resultado";
import { faltaParaCausar, resolverCuenta } from "@/lib/causacion";
import type { PoolClient } from "pg";

// EL BOTÓN "CAUSAR" APRUEBA, NO ESCRIBE.
//
// Quien escribe en Siigo es un cron de la VM (ejecutar_causaciones.py, repo
// datawarehouse). Dos razones, y ninguna es de comodidad:
//   1. Las credenciales de Siigo no viven en Vercel.
//   2. Ese motor ya tiene probado el candado que impide causar dos veces —
//      reserva en `causacion_log` ANTES del POST, y un POST sin respuesta nunca
//      se reintenta a ciegas, se va a preguntarle a Siigo si quedó.
// Un POST desde acá tendría que reimplementar las dos cosas, y una segunda
// implementación de un candado de dinero es una que se rompe en silencio.

const done = () => revalidatePath("/contabilidad/causaciones");
const cufesDe = (fd: FormData) =>
  String(fd.get("cufes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** La misma consulta que la pantalla, para UNA factura y dentro de la
 *  transacción. La pantalla decide qué se VE; esto decide qué se PUEDE — y son
 *  dos cosas distintas: quien tenía la página abierta desde antes sigue viendo
 *  los botones del build anterior. Así se pagaron 5 cuentas de cobro sin destino
 *  el 21-ago. */
const SQL_ESTADO = `
  SELECT e.concepto, e.destino, e.retencion_ok, e.causacion_estado,
         md.centro_costo,
         mp.cuenta_puc_default AS cuenta_proveedor,
         mc.cuenta_puc         AS cuenta_concepto,
         (SELECT count(*) > 0 FROM maestro_cuentas_puc p
           WHERE p.activo AND p.codigo = coalesce(mp.cuenta_puc_default, mc.cuenta_puc)) AS cuenta_valida,
         EXISTS (SELECT 1 FROM facturas nc
                  WHERE nc.ref_cufe = e.cufe AND nc.doc_tipo = 'CreditNote') AS anulada,
         f.numero
    FROM factura_estado e
    JOIN facturas f ON f.cufe = e.cufe
    LEFT JOIN maestro_destinos    md ON md.nombre = e.destino AND md.activo
    LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor AND mp.activo
    LEFT JOIN maestro_conceptos   mc ON mc.nombre = e.concepto AND mc.activo
   WHERE e.cufe = $1
   FOR UPDATE OF e`;

/** Aprueba para causar. La cuenta y el centro de costo se CONGELAN acá.
 *
 *  Congelarlos no es un detalle: si se resolvieran al ejecutar, un cambio en los
 *  maestros entre la aprobación y el cron haría que el asiento no fuera el que
 *  alguien aprobó. Y el centro de costo es la TIENDA del P&L — moverlo después
 *  le cambia el costo a dos tiendas sin que nadie lo haya decidido. */
export async function aprobarCausacion(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("causar");
    const cufes = cufesDe(fd);
    if (!cufes.length) throw new Error("Selecciona al menos una factura.");
    await withTx(async (c: PoolClient) => {
      for (const cufe of cufes) {
        const { rows } = await c.query(SQL_ESTADO, [cufe]);
        const r = rows[0];
        if (!r) throw new Error(`No encuentro la factura ${cufe}.`);
        if (r.causacion_estado === "causada") {
          throw new Error(`${r.numero} ya está causada en Siigo — no se aprueba dos veces.`);
        }
        const falta = faltaParaCausar(r as never);
        if (falta.length) {
          throw new Error(`${r.numero} todavía no se puede causar: ${falta.join("; ")}.`);
        }
        const { cuenta } = resolverCuenta(r as never);
        await c.query(
          `UPDATE factura_estado
              SET causacion_estado = 'aprobada',
                  causacion_autorizada_por = $2,
                  causacion_aprobada_en = now(),
                  causacion_cuenta_puc = $3,
                  causacion_centro_costo = $4,
                  causacion_error = NULL,
                  actualizado_en = now()
            WHERE cufe = $1`,
          [cufe, user.email, cuenta, r.centro_costo]);
        await registrarEvento(c, {
          cufe, tipo: "aprueba_causacion", campo: "causacion_estado",
          valorAnterior: { causacion_estado: r.causacion_estado },
          valorNuevo: { causacion_estado: "aprobada", cuenta_puc: cuenta,
                        centro_costo: r.centro_costo },
          actor: user.email, actorRol: user.rol, origen: "web",
        });
      }
    });
    done();
  });
}

/** Deshace la aprobación mientras el cron no la haya ejecutado.
 *
 *  Solo sale de 'aprobada' o 'error'. Una ya causada NO se retira desde acá: el
 *  asiento existe en Siigo y borrarle la marca al portal no lo borra allá — lo
 *  único que lograría es que se causara otra vez. Eso se anula en Siigo, a mano. */
export async function retirarAprobacion(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("causar");
    const cufes = cufesDe(fd);
    if (!cufes.length) throw new Error("Selecciona al menos una factura.");
    await withTx(async (c: PoolClient) => {
      const { rows } = await c.query<{ cufe: string; causacion_estado: string | null; numero: string }>(
        `SELECT e.cufe, e.causacion_estado, f.numero
           FROM factura_estado e JOIN facturas f ON f.cufe = e.cufe
          WHERE e.cufe = ANY($1) FOR UPDATE OF e`, [cufes]);
      for (const r of rows) {
        if (r.causacion_estado === "causada") {
          throw new Error(
            `${r.numero} ya está causada en Siigo. Quitarle la marca acá no borra ` +
            `el asiento allá — se anula en Siigo y luego se corrige acá.`);
        }
      }
      await c.query(
        `UPDATE factura_estado
            SET causacion_estado = NULL, causacion_autorizada_por = NULL,
                causacion_aprobada_en = NULL, causacion_cuenta_puc = NULL,
                causacion_centro_costo = NULL, actualizado_en = now()
          WHERE cufe = ANY($1) AND causacion_estado IN ('aprobada','error')`, [cufes]);
      await registrarEvento(c, {
        cufe: null, tipo: "retira_causacion", campo: "causacion_estado",
        valorNuevo: { facturas: cufes.length },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    done();
  });
}

/** Le fija la cuenta contable a un PROVEEDOR desde la bandeja.
 *
 *  Es lo que rompe el círculo: hasta hoy el motor solo sabía causar lo que ya se
 *  había causado antes, porque aprendía del histórico de Siigo. Un proveedor que
 *  nunca se causó no tiene de dónde aprender — y son justo los que llevan meses
 *  sin causarse (Parque Arauco: $17,4M del arriendo de Colina). Se fija UNA vez
 *  y ese proveedor queda resuelto para siempre. */
export async function fijarCuentaProveedor(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("causar");
    const nit = String(fd.get("nit") ?? "").trim();
    const cuenta = String(fd.get("cuenta") ?? "").trim();
    const nombre = String(fd.get("nombre") ?? "").trim();
    if (!nit) throw new Error("Falta el NIT del proveedor.");
    if (!cuenta) throw new Error("Elige la cuenta contable.");
    await withTx(async (c: PoolClient) => {
      const v = await c.query(
        "SELECT 1 FROM maestro_cuentas_puc WHERE codigo = $1 AND activo", [cuenta]);
      if (!v.rowCount) {
        throw new Error(
          `La cuenta ${cuenta} no está en el plan de cuentas. Si es nueva, ` +
          `cárgala primero en Maestros: una cuenta que Siigo no conoce hace ` +
          `fallar el asiento, o peor, lo deja en el lugar equivocado.`);
      }
      const prev = await c.query<{ cuenta_puc_default: string | null }>(
        "SELECT cuenta_puc_default FROM maestro_proveedores WHERE nit = $1", [nit]);
      await c.query(
        `INSERT INTO maestro_proveedores (nit, nombre, cuenta_puc_default, fuente, activo, actualizado_en)
              VALUES ($1, $2, $3, 'humano', TRUE, now())
         ON CONFLICT (nit) DO UPDATE
            SET cuenta_puc_default = EXCLUDED.cuenta_puc_default,
                fuente = 'humano', actualizado_en = now()`,
        [nit, nombre || nit, cuenta]);
      await registrarEvento(c, {
        cufe: null, tipo: "fija_cuenta_proveedor", campo: "cuenta_puc_default",
        valorAnterior: prev.rows[0]?.cuenta_puc_default ?? null,
        valorNuevo: { nit, cuenta },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    done();
  });
}
