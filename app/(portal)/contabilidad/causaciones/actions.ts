"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { intentar, type Resultado } from "@/lib/resultado";
import { faltaParaCausar, resolverCuenta } from "@/lib/causacion";
import { guardarClasificacion } from "../conciliacion/actions";
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
         f.numero, al.mensaje AS alerta
    FROM factura_estado e
    JOIN facturas f ON f.cufe = e.cufe
    LEFT JOIN maestro_destinos    md ON md.nombre = e.destino AND md.activo
    LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor AND mp.activo
    LEFT JOIN maestro_conceptos   mc ON mc.nombre = e.concepto AND mc.activo
    LEFT JOIN clasificacion_alerta al ON al.cufe = e.cufe
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
          // Si tenía sospecha de concepto mal puesto, queda ESCRITO que se
          // aprobó igual. El aviso no bloquea, pero saltárselo no puede ser
          // invisible: si después el gasto quedó en la línea equivocada del
          // P&L, la bitácora dice que alguien lo vio y siguió.
          valorNuevo: { causacion_estado: "aprobada", cuenta_puc: cuenta,
                        centro_costo: r.centro_costo,
                        ...(r.alerta ? { aprobada_pese_a: r.alerta } : {}) },
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

/** Marca que esta factura NO se causa, con el motivo escrito.
 *
 *  El motivo es obligatorio y no es burocracia: hoy toda factura no causada se
 *  ve igual —trabajo pendiente— aunque alguien ya haya decidido hace un mes.
 *  Con esto, «quedó por fuera» vuelve a significar «nadie la ha mirado». Y
 *  cuando el contador pregunte por qué falta una del cierre, la respuesta está
 *  escrita y firmada en vez de en la memoria de alguien.
 *
 *  Es reversible (`reactivarCausacion`) y NO aplica a una ya causada: el asiento
 *  existe en Siigo y decir acá que «no se causa» no lo borra. */
export async function marcarNoCausa(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("causar");
    const cufes = cufesDe(fd);
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (!cufes.length) throw new Error("Selecciona al menos una factura.");
    if (motivo.length < 10) {
      throw new Error(
        "Escribe por qué no se causa (al menos 10 caracteres). Este texto es la " +
        "respuesta cuando alguien pregunte por qué falta en el cierre.");
    }
    await withTx(async (c: PoolClient) => {
      const { rows } = await c.query<{ cufe: string; causacion_estado: string | null; numero: string }>(
        `SELECT e.cufe, e.causacion_estado, f.numero
           FROM factura_estado e JOIN facturas f ON f.cufe = e.cufe
          WHERE e.cufe = ANY($1) FOR UPDATE OF e`, [cufes]);
      for (const r of rows) {
        if (r.causacion_estado === "causada") {
          throw new Error(
            `${r.numero} ya está causada en Siigo. Marcarla «no causa» acá no ` +
            `borra el asiento allá — se anula en Siigo y después se corrige acá.`);
        }
      }
      await c.query(
        `UPDATE factura_estado
            SET causacion_estado = 'no_causa', no_causa_motivo = $2,
                no_causa_por = $3, no_causa_en = now(),
                causacion_cuenta_puc = NULL, causacion_centro_costo = NULL,
                actualizado_en = now()
          WHERE cufe = ANY($1) AND causacion_estado IS DISTINCT FROM 'causada'`,
        [cufes, motivo, user.email]);
      for (const cufe of cufes) {
        await registrarEvento(c, {
          cufe, tipo: "no_causa", campo: "causacion_estado",
          valorNuevo: { causacion_estado: "no_causa", motivo },
          actor: user.email, actorRol: user.rol, origen: "web",
        });
      }
    });
    done();
  });
}

/** Devuelve una «no causa» a la fila. El motivo anterior NO se borra: queda en
 *  la bitácora, porque la decisión de hoy se entiende sabiendo la de ayer. */
export async function reactivarCausacion(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("causar");
    const cufes = cufesDe(fd);
    if (!cufes.length) throw new Error("Selecciona al menos una factura.");
    await withTx(async (c: PoolClient) => {
      await c.query(
        `UPDATE factura_estado
            SET causacion_estado = NULL, no_causa_motivo = NULL,
                no_causa_por = NULL, no_causa_en = NULL, actualizado_en = now()
          WHERE cufe = ANY($1) AND causacion_estado = 'no_causa'`, [cufes]);
      await registrarEvento(c, {
        cufe: null, tipo: "reactiva_causacion", campo: "causacion_estado",
        valorNuevo: { facturas: cufes.length },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    done();
  });
}

/** Causa esta factura a un TERCERO distinto del que la emitió.
 *
 *  Pasa por negociación: el proveedor factura a nombre de uno y el gasto es de
 *  otro. Tres candados, los mismos del desvío de cuenta bancaria en Pagos:
 *    · se hace de una factura en una, nunca en lote;
 *    · el motivo es obligatorio y queda en la bitácora;
 *    · NO toca el maestro del proveedor — si se guardara, un caso puntual se
 *      volvería la regla y todas sus facturas siguientes irían al tercero
 *      equivocado sin que nadie lo decidiera.
 *
 *  Y el tercero tiene que EXISTIR en Siigo: mandar un NIT que no conoce hace
 *  fallar el POST, y descubrirlo ahí es tarde. */
export async function cambiarTercero(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("causar");
    const cufe = String(fd.get("cufe") ?? "").trim();
    const nit = String(fd.get("nit") ?? "").trim();
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (!cufe) throw new Error("Falta la factura.");
    if (!nit) throw new Error("Elige el tercero.");
    if (motivo.length < 10) {
      throw new Error("Escribe por qué se causa a otro tercero (al menos 10 caracteres).");
    }
    await withTx(async (c: PoolClient) => {
      const t = await c.query<{ nombre: string | null; activo: boolean }>(
        "SELECT nombre, activo FROM maestro_terceros_siigo WHERE nit = $1", [nit]);
      if (!t.rowCount) {
        throw new Error(
          `El NIT ${nit} no existe como tercero en Siigo. Créalo allá primero: ` +
          `si se manda así, Siigo rechaza el asiento.`);
      }
      if (!t.rows[0].activo) {
        throw new Error(`El tercero ${nit} está INACTIVO en Siigo. Actívalo allá primero.`);
      }
      const prev = await c.query<{ causacion_tercero_nit: string | null; causacion_estado: string | null }>(
        "SELECT causacion_tercero_nit, causacion_estado FROM factura_estado WHERE cufe = $1 FOR UPDATE",
        [cufe]);
      if (!prev.rowCount) throw new Error("No encuentro la factura.");
      if (prev.rows[0].causacion_estado === "causada") {
        throw new Error(
          "Ya está causada en Siigo: el asiento salió con el tercero anterior y " +
          "cambiarlo acá no lo mueve allá. Se corrige en Siigo.");
      }
      await c.query(
        `UPDATE factura_estado
            SET causacion_tercero_nit = $2, causacion_tercero_nombre = $3,
                causacion_tercero_motivo = $4, actualizado_en = now()
          WHERE cufe = $1`, [cufe, nit, t.rows[0].nombre, motivo]);
      await registrarEvento(c, {
        cufe, tipo: "cambia_tercero", campo: "causacion_tercero_nit",
        valorAnterior: prev.rows[0].causacion_tercero_nit,
        valorNuevo: { nit, nombre: t.rows[0].nombre, motivo },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    done();
  });
}

/** Vuelve al tercero de la factura (el que la emitió). */
export async function quitarTercero(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("causar");
    const cufe = String(fd.get("cufe") ?? "").trim();
    if (!cufe) throw new Error("Falta la factura.");
    await withTx(async (c: PoolClient) => {
      const prev = await c.query<{ causacion_tercero_nit: string | null }>(
        "SELECT causacion_tercero_nit FROM factura_estado WHERE cufe = $1 FOR UPDATE", [cufe]);
      await c.query(
        `UPDATE factura_estado SET causacion_tercero_nit = NULL,
            causacion_tercero_nombre = NULL, causacion_tercero_motivo = NULL,
            actualizado_en = now() WHERE cufe = $1`, [cufe]);
      await registrarEvento(c, {
        cufe, tipo: "quita_tercero", campo: "causacion_tercero_nit",
        valorAnterior: prev.rows[0]?.causacion_tercero_nit ?? null, valorNuevo: null,
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    done();
  });
}

/** Reclasificar concepto y destino SIN salir de causación.
 *
 *  Reusa `guardarClasificacion` de Conciliación — el mismo camino de escritura,
 *  no una copia: con una copia por pantalla el maestro aprende por un lado solo
 *  y las dos listas se separan. Quien causa ve la factura completa y es quien
 *  más rápido detecta que el destino está mal; obligarlo a cambiar de pantalla
 *  es la fricción que hace que no lo corrija. */
export async function reclasificarDesdeCausacion(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    await guardarClasificacion(fd);
    done();
  });
}
