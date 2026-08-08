// Copiloto de conciliación: herramientas (function calling) que leen los datos
// VIVOS de Neon. Claude decide cuál usar; nosotros corremos SELECTs parametrizados
// (solo lectura, nada de SQL libre → sin inyección) y le devolvemos el resultado.
import { getPool } from "@/lib/db";

export const MODELO = process.env.ASISTENTE_MODEL || "claude-sonnet-5";

export const SYSTEM = `Eres el copiloto de Conciliación de Pagos de Oakberry Colombia (ManelFoods).
Ayudas al equipo de contabilidad a entender el estado de sus facturas de proveedores.

Contexto del flujo: las facturas llegan por la DIAN (buzón → XML → BigQuery) y se sincronizan
a este portal. Cada factura pasa por: capturada → clasificada (concepto + destino + plazo) →
retenciones_ok (retenciones confirmadas) → aprobada_pago → pagada → causada (en Siigo).
El "cerebro" es el maestro de proveedores: cada NIT aprende su concepto/destino/cuenta PUC/
plazo/retenciones, y su "confianza" mide qué tan consistente es su historia (0–1).

Reglas:
- Responde SIEMPRE con datos reales: usa las herramientas para consultar, no inventes cifras.
- Sé conciso y concreto. Da números y nombres. Formato pesos colombianos (ej. $1.234.000).
- Si te preguntan algo que no puedes responder con las herramientas, dilo claramente.
- Responde en español, tono cercano y profesional. No te disculpes de más.`;

type Tool = {
  schema: { name: string; description: string; input_schema: Record<string, unknown> };
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

const cop = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CO");

export const TOOLS: Record<string, Tool> = {
  resumen_conciliacion: {
    schema: {
      name: "resumen_conciliacion",
      description: "Panorama general: cuántas facturas hay por estado, valor total, total a pagar, cobertura de concepto/destino y retenciones. Úsalo para preguntas de '¿cómo vamos?', '¿cuántas faltan?'.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => {
      const { rows } = await getPool().query(`
        SELECT
          count(*)::int total,
          count(*) FILTER (WHERE e.estado='capturada')::int por_clasificar,
          count(*) FILTER (WHERE e.estado='clasificada')::int clasificadas,
          count(*) FILTER (WHERE e.estado='retenciones_ok')::int listas_pago,
          count(*) FILTER (WHERE e.estado IN ('pagada','causada'))::int pagadas,
          count(*) FILTER (WHERE e.retencion_ok)::int con_retencion,
          coalesce(sum(f.total),0)::float valor_total,
          coalesce(sum(coalesce(e.valor_a_pagar,f.total)) FILTER (WHERE e.estado='retenciones_ok'),0)::float a_pagar_listo
        FROM facturas f JOIN factura_estado e USING (cufe)`);
      const r = rows[0];
      return { ...r, valor_total: cop(r.valor_total), a_pagar_listo: cop(r.a_pagar_listo) };
    },
  },

  buscar_proveedor: {
    schema: {
      name: "buscar_proveedor",
      description: "Ficha del maestro de un proveedor por nombre o NIT: concepto/destino/cuenta PUC por defecto, plazo de pago, confianza (0–1), nº de facturas y sus tarifas de retención.",
      input_schema: {
        type: "object",
        properties: { texto: { type: "string", description: "nombre (parcial) o NIT del proveedor" } },
        required: ["texto"],
      },
    },
    run: async (i) => {
      const q = String(i.texto ?? "").trim();
      const { rows } = await getPool().query(
        `SELECT nit, nombre, concepto_default, destino_default, cuenta_puc_default,
                plazo_dias, confianza::float, n_facturas, retencion_hint
         FROM maestro_proveedores
         WHERE nit = $1 OR lower(nombre) LIKE '%'||lower($1)||'%'
         ORDER BY n_facturas DESC NULLS LAST LIMIT 5`, [q]);
      for (const r of rows as Record<string, unknown>[]) {
        const ret = await getPool().query(
          "SELECT tipo, tarifa::float FROM maestro_retenciones WHERE nit_proveedor = $1", [r.nit]);
        r.retenciones = ret.rows.map((x) => `${x.tipo} ${x.tarifa}%`);
      }
      return rows.length ? rows : "Sin proveedor que coincida.";
    },
  },

  metricas_semanales: {
    schema: {
      name: "metricas_semanales",
      description: "Evolución semanal (últimas N semanas): facturas, valor, % confiable/concepto/destino, captura DIAN (fuga) y causadas. Para preguntas de tendencia, fuga, cobertura por semana.",
      input_schema: {
        type: "object",
        properties: { semanas: { type: "integer", description: "cuántas semanas recientes (default 8)" } },
      },
    },
    run: async (i) => {
      const n = Math.min(Number(i.semanas) || 8, 30);
      const { rows } = await getPool().query(`
        WITH sem AS (
          SELECT to_char(f.fecha_emision,'IYYY')||'-S'||to_char(f.fecha_emision,'IW') semana,
            count(*)::int facturas, coalesce(sum(f.total),0)::float valor,
            round(100.0*count(*) FILTER (WHERE mp.confianza>=0.8)/count(*)) confiable_pct,
            round(100.0*count(*) FILTER (WHERE COALESCE(p.concepto_sug,mp.concepto_default,e.concepto) IS NOT NULL)/count(*)) concepto_pct,
            round(100.0*count(*) FILTER (WHERE COALESCE(p.destino_sug,mp.destino_default,e.destino) IS NOT NULL)/count(*)) destino_pct
          FROM facturas f JOIN factura_estado e USING(cufe)
          LEFT JOIN factura_propuesta p USING(cufe)
          LEFT JOIN maestro_proveedores mp ON mp.nit=f.nit_proveedor
          GROUP BY semana)
        SELECT sem.*, ds.dian, ds.capturadas,
               CASE WHEN ds.dian>0 THEN round(100.0*ds.capturadas/ds.dian) END captura_pct,
               CASE WHEN ds.dian>0 THEN round(100.0*ds.causadas/ds.dian) END causadas_pct
        FROM sem LEFT JOIN dashboard_semana ds ON ds.semana=sem.semana
        ORDER BY sem.semana DESC LIMIT $1`, [n]);
      return rows.map((r) => ({ ...r, valor: cop(r.valor) }));
    },
  },

  buscar_facturas: {
    schema: {
      name: "buscar_facturas",
      description: "Lista facturas filtrando por proveedor, concepto, destino, estado o rango de fechas. Devuelve máx. 25. Para '¿qué facturas de X hay?', '¿cuáles faltan por clasificar?'.",
      input_schema: {
        type: "object",
        properties: {
          proveedor: { type: "string" }, concepto: { type: "string" }, destino: { type: "string" },
          estado: { type: "string", description: "capturada|clasificada|retenciones_ok|pagada|causada" },
          desde: { type: "string", description: "YYYY-MM-DD" }, hasta: { type: "string", description: "YYYY-MM-DD" },
        },
      },
    },
    run: async (i) => {
      const w: string[] = []; const p: unknown[] = [];
      const add = (cond: string, val: unknown) => { p.push(val); w.push(cond.replace("$?", "$" + p.length)); };
      if (i.proveedor) add("lower(f.nombre_proveedor) LIKE '%'||lower($?)||'%'", i.proveedor);
      if (i.concepto) add("lower(e.concepto) LIKE '%'||lower($?)||'%'", i.concepto);
      if (i.destino) add("lower(e.destino) LIKE '%'||lower($?)||'%'", i.destino);
      if (i.estado) add("e.estado = $?", i.estado);
      if (i.desde) add("f.fecha_emision >= $?", i.desde);
      if (i.hasta) add("f.fecha_emision <= $?", i.hasta);
      const where = w.length ? "WHERE " + w.join(" AND ") : "";
      const { rows } = await getPool().query(
        `SELECT f.nombre_proveedor proveedor, f.numero, f.fecha_emision, f.total::float,
                e.estado, e.concepto, e.destino
         FROM facturas f JOIN factura_estado e USING (cufe)
         ${where} ORDER BY f.fecha_emision DESC LIMIT 25`, p);
      return { encontradas: rows.length, facturas: rows.map((r) => ({ ...r, total: cop(r.total) })) };
    },
  },

  nomenclatura: {
    schema: {
      name: "nomenclatura",
      description: "Lista los conceptos y destinos oficiales (la nomenclatura del maestro). Para '¿qué conceptos existen?', '¿a qué destino va X?'.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => {
      const c = await getPool().query("SELECT nombre FROM maestro_conceptos WHERE activo ORDER BY nombre");
      const d = await getPool().query("SELECT nombre FROM maestro_destinos WHERE activo ORDER BY nombre");
      return { conceptos: c.rows.map((x) => x.nombre), destinos: d.rows.map((x) => x.nombre) };
    },
  },
};

export const TOOL_SCHEMAS = Object.values(TOOLS).map((t) => t.schema);
