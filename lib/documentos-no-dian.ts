// EL DOCUMENTO QUE NO TIENE FACTURA DIAN, Y QUE IGUAL HAY QUE CLASIFICAR.
//
// Dos cosas entran por acá y siguen el MISMO camino que una factura:
//
//   · la CUENTA DE COBRO que sube un proveedor por el portal público (quien no
//     factura electrónicamente: honorarios, reembolsos, arriendos por fiducia);
//   · el gasto INTERNO que carga una persona del equipo desde el portal —
//     SERVICIOS PÚBLICOS y otros que nadie nos factura a nosotros directamente.
//
// Antes, aprobar mandaba la cuenta de cobro DERECHO a Pagos. Se pagaba bien,
// pero el gasto quedaba sin concepto contable y sin destino: nadie podía decir
// después en qué tienda cayó esa plata, y el destino vacío no se llena solo.
// Ahora aprobar la vuelve CLASIFICABLE y el paso a Pagos lo abre la
// clasificación, igual que con una factura.
//
// Por qué NO viven en `facturas`: esa tabla es el espejo de la identidad DIAN
// (su llave es el CUFE, que emite la DIAN). Meter acá un documento sin CUFE
// obligaría a inventarle uno, y a partir de ahí nadie podría distinguir lo que
// la DIAN certificó de lo que escribimos nosotros. Viven en `cuentas_cobro`,
// que ya trae retenciones, aprobación, correos y enlace al pago.

import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { refDe } from "@/lib/ref-documento";

/** LA REGLA, EN UN SOLO LUGAR: ¿este documento ya puede entrar al tablero de
 *  Pagos? Tiene que estar aprobado, sin pago asociado, y CLASIFICADO —
 *  concepto, destino y retenciones confirmadas.
 *
 *  Se escribe como SQL y no como función de TypeScript porque la usan tres
 *  consultas distintas (la bandeja, el tablero y el archivo del banco). Tres
 *  copias del mismo `WHERE` es como se rompió el candado de aprobación: una
 *  envejeció sin que nadie lo notara. `pfx` es el alias de la tabla. */
export const LISTO_PARA_PAGOS = (pfx: string) =>
  `${pfx}.estado = 'aprobada' AND ${pfx}.pago_id IS NULL
   AND ${pfx}.concepto IS NOT NULL AND ${pfx}.destino IS NOT NULL
   AND ${pfx}.retencion_ok`;

/** Lo que TODAVÍA no está clasificado: lo que aparece en Conciliación esperando
 *  concepto, destino y retenciones.
 *
 *  Incluye lo YA PAGADO a propósito. El 20-ago se pagaron 5 cuentas de cobro sin
 *  destino (la pantalla vieja seguía abierta) y, si esta lista las escondiera,
 *  ese gasto se quedaría sin decir en qué tienda cayó PARA SIEMPRE — que es
 *  justo el problema que este carril vino a resolver. Pagar no es archivar. */
export const POR_CLASIFICAR = (pfx: string) =>
  `${pfx}.estado IN ('aprobada', 'pagada')
   AND NOT (${pfx}.concepto IS NOT NULL AND ${pfx}.destino IS NOT NULL AND ${pfx}.retencion_ok)`;

export type DocNoDian = {
  id: number;
  ref: string;                       // CC-46 · SP-51 — se ve distinto de un CUFE a propósito
  tipo: string;                      // cuenta_cobro | servicio_publico | otro
  tipo_detalle: string | null;
  origen: string;                    // portal_publico | interno
  razon_social: string;
  num_doc: string;
  numero: string | null;
  descripcion: string | null;
  area: string | null;
  fecha: string;                     // fecha del documento, o la de llegada
  creado_en: string;
  valor: number;
  concepto: string | null;
  destino: string | null;
  plazo_dias: number | null;
  retencion_ok: boolean;
  reten_total: number | null;
  retefuente: number | null;
  reteiva: number | null;
  reteica: number | null;
  otros_valor: number | null;
  otros_concepto: string | null;
  observaciones: string | null;
  valor_a_pagar: number | null;
  n_docs: number;
  soporte_url: string | null;
  tiene_banco: boolean;
  iva_incluido: number | null;
  // Tarifas del maestro del proveedor: precargan el modal de retenciones, igual
  // que en una factura. Sin ellas el modal abre en blanco y se teclea de nuevo
  // lo que el sistema ya sabe.
  tar_rf: string | null; tar_iva: string | null; tar_ica: string | null;
  /** Lo que el equipo YA practica para este concepto (no se aplica solo: lo
   *  sugiere el modal diciendo en cuántos casos se basa). */
  rc_rf: string | null; rc_ica: string | null; rc_aplica: boolean | null;
  rc_n: number | null; rc_conc: string | null; rc_fuente: string | null;
};

const CAMPOS = `
  cc.id, cc.tipo, cc.tipo_detalle, cc.origen, cc.razon_social, cc.num_doc, cc.numero,
  cc.descripcion, cc.area,
  coalesce(cc.fecha_documento, cc.creado_en::date)::text AS fecha,
  cc.creado_en::text AS creado_en,
  coalesce(cc.valor,0)::float AS valor,
  cc.concepto, cc.destino, cc.plazo_dias, cc.retencion_ok,
  cc.reten_total::float, cc.retefuente::float, cc.reteiva::float, cc.reteica::float,
  cc.otros_valor::float, cc.otros_concepto, cc.observaciones,
  cc.valor_a_pagar::float,
  jsonb_array_length(coalesce(cc.documentos,'[]'::jsonb))::int AS n_docs,
  (SELECT d->>'path' FROM jsonb_array_elements(coalesce(cc.documentos,'[]'::jsonb)) d
    WHERE d->>'clase' = 'soporte' AND coalesce(d->>'path','') <> '' LIMIT 1) AS soporte_url,
  cc.iva_incluido::float AS iva_incluido,
  mr.ret_rf::float::text AS tar_rf, mr.ret_iva::float::text AS tar_iva, mr.ret_ica::float::text AS tar_ica,
  rc.retefuente::text AS rc_rf, rc.reteica::text AS rc_ica, rc.aplica AS rc_aplica,
  rc.n_casos AS rc_n, rc.concordancia::text AS rc_conc, rc.fuente AS rc_fuente,
  (cb.num_cuenta IS NOT NULL) AS tiene_banco`;

/** La referencia visible. Lleva prefijo por tipo para que en la grilla se lea de
 *  un golpe qué es, y NUNCA se parezca a un CUFE (96 hex): quien mira la
 *  pantalla tiene que poder decir "esto no lo certificó la DIAN". */
// La referencia (CC-46 / SP-51) la arma un módulo PURO, que es también el que
// la sabe leer de vuelta cuando el Excel de retenciones la devuelve.
export { refDe };

/** Los documentos sin factura DIAN que están esperando clasificación. */
export async function porClasificar(): Promise<DocNoDian[]> {
  const { rows } = await getPool().query<Omit<DocNoDian, "ref">>(
    `SELECT ${CAMPOS}
       FROM cuentas_cobro cc
       LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = cc.num_doc
       LEFT JOIN (
         SELECT nit_proveedor,
                max(CASE WHEN tipo='ReteFuente' THEN tarifa END) AS ret_rf,
                max(CASE WHEN tipo='ReteICA'    THEN tarifa END) AS ret_ica,
                max(CASE WHEN tipo='ReteIVA'    THEN tarifa END) AS ret_iva
           FROM maestro_retenciones GROUP BY nit_proveedor
       ) mr ON mr.nit_proveedor = cc.num_doc
       LEFT JOIN regla_retencion_concepto rc ON rc.concepto = cc.concepto
      WHERE ${POR_CLASIFICAR("cc")}
      ORDER BY cc.creado_en`);
  return rows.map((r) => ({ ...r, ref: refDe(r.tipo, r.id) }));
}

/** Guarda concepto/destino/plazo de un documento y deja su evento.
 *
 *  No mueve el estado: el estado sigue siendo 'aprobada'. Lo que abre el paso a
 *  Pagos es tener los tres datos (`LISTO_PARA_PAGOS`), no una bandera aparte —
 *  una bandera y una condición terminan diciendo cosas distintas. */
export async function clasificar(
  c: PoolClient, id: number,
  campos: { concepto?: string | null; destino?: string | null; plazo_dias?: number | null },
  actor: { email: string; rol: string },
): Promise<void> {
  const cur = await c.query<{ concepto: string | null; destino: string | null; plazo_dias: number | null; estado: string; pago_id: number | null }>(
    "SELECT concepto, destino, plazo_dias, estado, pago_id FROM cuentas_cobro WHERE id = $1 FOR UPDATE", [id]);
  if (!cur.rowCount) throw new Error("Ese documento ya no existe.");
  const antes = cur.rows[0];
  // YA PAGADO: se puede LLENAR lo que está vacío, no CAMBIAR lo ya decidido.
  //
  // La diferencia no es un tecnicismo. Cambiar el destino de algo ya pagado deja
  // el registro contable diciendo algo distinto de lo que salió del banco —eso
  // sigue prohibido—, pero llenar un hueco no cambia ninguna decisión: la
  // completa. Sin esta distinción, las 5 cuentas de cobro que se pagaron sin
  // destino el 20-ago se quedaban sin clasificar para siempre.
  if (antes.pago_id) {
    const pisa = (["concepto", "destino", "plazo_dias"] as const).filter(
      (k) => k in campos && antes[k] != null && String(antes[k]) !== String(campos[k] ?? ""));
    if (pisa.length) {
      throw new Error(`Este documento ya se pagó: ${pisa.join(" y ")} no se puede cambiar `
        + "(el registro contable quedaría diciendo algo distinto de lo que salió del banco). "
        + "Lo que sí se puede es llenar lo que quedó vacío.");
    }
  }

  const sets: string[] = [], vals: unknown[] = [id];
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if ("concepto" in campos) { push("concepto", campos.concepto); sets.push("concepto_fuente = 'humano'"); }
  if ("destino" in campos)  { push("destino", campos.destino);   sets.push("destino_fuente = 'humano'"); }
  if ("plazo_dias" in campos) {
    push("plazo_dias", campos.plazo_dias);
    // El vencimiento se recalcula desde la fecha del documento, no desde hoy:
    // un documento que llegó hace tres semanas ya está corriendo su plazo.
    sets.push("fecha_vencimiento = coalesce(fecha_documento, creado_en::date) + coalesce($" + vals.length + ", 0)");
  }
  if (!sets.length) return;
  vals.push(actor.email); sets.push(`clasificada_por = $${vals.length}`);
  await c.query(`UPDATE cuentas_cobro SET ${sets.join(", ")}, clasificada_en = now() WHERE id = $1`, vals);

  await registrarEvento(c, {
    cufe: null, tipo: "clasifica_doc_no_dian", campo: Object.keys(campos).join(","),
    valorAnterior: { id, concepto: antes.concepto, destino: antes.destino, plazo_dias: antes.plazo_dias },
    valorNuevo: { id, ...campos },
    actor: actor.email, actorRol: actor.rol, origen: "web",
  });
}
