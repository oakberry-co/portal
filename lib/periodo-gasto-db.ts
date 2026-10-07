// ESCRIBIR EL MES DEL GASTO (§27 del esquema). El porqué está en periodo-gasto.ts.
//
// Reglas:
//   · Solo se guarda lo que fija una PERSONA (periodo_gasto_fuente='humano'). El
//     sync nunca lo escribe ni lo pisa: lo que nadie fijó se resuelve en la
//     vista v_factura_periodo (mes de emisión + corrimiento del proveedor).
//   · El proveedor APRENDE su corrimiento solo cuando DOS facturas suyas fijadas
//     a mano coinciden (Regla 13: una corrección puntual no re-mapea un maestro).
//     Una luz facturada tarde una vez no convierte al proveedor en «mes anterior».
//   · Entre seis meses antes y uno después de la emisión (OFFSET_MIN/MAX, el
//     mismo rango del CHECK de la base); fuera de eso se rechaza con motivo.
//
// Los imports son RELATIVOS (no "@/") a propósito: el centinela
// scripts/test_periodo_gasto.js compila este módulo con tsc suelto y lo corre
// contra la base real con ROLLBACK.
import type { PoolClient } from "pg";
import { registrarEvento } from "./eventos";
import { esMes, etiquetaMes, mesDe, offsetEntre, OFFSET_MAX, OFFSET_MIN } from "./periodo-gasto";

export type PatchPeriodo = {
  periodo_gasto: string;
  periodo_fuente: "humano";
  /** El corrimiento que el proveedor tiene aprendido después de esta acción (null = ninguno). */
  regla_proveedor: number | null;
};

export async function fijarPeriodoGasto(
  c: PoolClient, cufe: string, periodo: string, actor: { email: string; rol: string },
): Promise<PatchPeriodo> {
  if (!esMes(periodo)) throw new Error("El mes del gasto tiene que ser un mes (AAAA-MM-01).");

  const cur = await c.query<{
    fecha_emision: Date; nit_proveedor: string; nombre_proveedor: string | null;
    periodo_gasto: Date | null; periodo_offset_meses: number | null;
  }>(
    `SELECT f.fecha_emision, f.nit_proveedor, f.nombre_proveedor, e.periodo_gasto, mp.periodo_offset_meses
       FROM facturas f JOIN factura_estado e USING (cufe)
       LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
      WHERE f.cufe = $1 FOR UPDATE OF e`,
    [cufe]
  );
  if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
  const antes = cur.rows[0];

  const emision = mesDe(antes.fecha_emision);
  const offset = offsetEntre(emision, periodo);
  if (offset < OFFSET_MIN || offset > OFFSET_MAX) {
    throw new Error(
      `El mes del gasto tiene que estar entre ${-OFFSET_MIN} meses antes y ${OFFSET_MAX} después ` +
      `del de la factura (${etiquetaMes(emision)}). Si de verdad es otro, es un ajuste con el contador.`
    );
  }

  await c.query(
    `UPDATE factura_estado
        SET periodo_gasto = $2, periodo_gasto_fuente = 'humano', actualizado_en = now()
      WHERE cufe = $1`,
    [cufe, periodo]
  );

  // APRENDER: dos facturas del proveedor fijadas a mano con el MISMO corrimiento.
  // Se cuenta en la base (incluida la de ahora), no en memoria: si dos personas
  // fijan a la vez, la segunda ve a la primera.
  let regla: number | null = antes.periodo_offset_meses;
  if (antes.nit_proveedor && antes.nit_proveedor !== "ND") {
    const n = await c.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM facturas f JOIN factura_estado e USING (cufe)
        WHERE f.nit_proveedor = $1 AND e.periodo_gasto_fuente = 'humano'
          AND (EXTRACT(YEAR  FROM e.periodo_gasto) - EXTRACT(YEAR  FROM f.fecha_emision)) * 12
            + (EXTRACT(MONTH FROM e.periodo_gasto) - EXTRACT(MONTH FROM f.fecha_emision)) = $2`,
      [antes.nit_proveedor, offset]
    );
    if (Number(n.rows[0].n) >= 2 && regla !== offset) {
      await c.query(
        `INSERT INTO maestro_proveedores (nit, nombre, periodo_offset_meses, fuente, creado_por)
         VALUES ($1, $2, $3, 'humano', $4)
         ON CONFLICT (nit) DO UPDATE SET
           periodo_offset_meses = EXCLUDED.periodo_offset_meses,
           fuente = 'humano', actualizado_en = now()`,
        [antes.nit_proveedor, antes.nombre_proveedor, offset, actor.email]
      );
      regla = offset;
    }
  }

  await registrarEvento(c, {
    cufe, tipo: "set_periodo_gasto", campo: "periodo_gasto",
    valorAnterior: { periodo_gasto: antes.periodo_gasto ? mesDe(antes.periodo_gasto) : null },
    valorNuevo: { periodo_gasto: periodo, offset_meses: offset, regla_proveedor: regla },
    actor: actor.email, actorRol: actor.rol, origen: "web",
  });

  return { periodo_gasto: periodo, periodo_fuente: "humano", regla_proveedor: regla };
}
