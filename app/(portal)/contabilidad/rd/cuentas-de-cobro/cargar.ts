// LO QUE LEEN LAS PANTALLAS DE RD. Desde el 19-nov-2026 RD no tiene pantalla
// propia: se revisa en Contabilidad › Cuentas de cobro y se paga en
// Contabilidad › Pagos, con el selector de país (app/SelectorPais.tsx). Las
// dos páginas cargan de acá, así una tarjeta no puede verse distinta según
// dónde se mire.
//
// Este módulo es el ÚNICO lugar de esas dos páginas que lee rd_cuentas_cobro:
// el SQL colombiano de Pagos (pagos/page.tsx, pagos/export) no la nombra nunca,
// y el centinela test_rd_cuentas_cobro.js lo vigila.

import { headers } from "next/headers";
import { getPool } from "@/lib/db";
import { propuesta, type Propuesta } from "@/lib/rd/retenciones";
import type { CobroRD } from "./BandejaRD";

/** Trae, por cobro, TODO lo que decide si se puede aprobar: los documentos, la
 *  propuesta de retención con la regla de su mes y las cuentas a las que ya se
 *  le pagó a esa identificación (de ahí sale el aviso de cambio de cuenta). Así
 *  la tarjeta EXPLICA el bloqueo en vez de mostrar un botón que falla al hacer
 *  clic. El servidor lo vuelve a evaluar al aprobar. */
export async function cargarCobrosRD(): Promise<CobroRD[]> {
  const { rows } = await getPool().query<Omit<CobroRD, "propuesta">>(
    `SELECT cc.id, cc.tipo_persona, cc.nombre, cc.tipo_id, cc.num_id, cc.id_verifica, cc.correo, cc.telefono,
            cc.instagram, cc.concepto, cc.concepto_otro, cc.descripcion, cc.periodo::text AS periodo, cc.enlaces,
            cc.moneda, cc.valor::float AS valor, cc.itbis_facturado::float AS itbis_facturado,
            cc.ncf_proveedor, cc.fecha_ncf::text AS fecha_ncf, cc.banco, cc.tipo_cuenta, cc.num_cuenta,
            cc.titular_cuenta, cc.documentos, cc.estado, cc.nota_revision, cc.confirmacion,
            cc.isr_retenido::float AS isr_retenido, cc.itbis_retenido::float AS itbis_retenido,
            cc.retencion_ok, cc.valor_a_pagar::float AS valor_a_pagar, cc.ncf_emitido,
            cc.revisado_por, cc.aprobado_en::text AS aprobado_en, cc.pagado_en::text AS pagado_en,
            cc.pagado_por, cc.referencia_pago, cc.comprobante_url, cc.creado_en::text AS creado_en,
            coalesce(h.pagadas, '[]') AS pagadas
       FROM rd_cuentas_cobro cc
       LEFT JOIN LATERAL (
         SELECT json_agg(DISTINCT jsonb_build_object('banco', p.banco, 'num_cuenta', p.num_cuenta)) AS pagadas
           FROM rd_cuentas_cobro p
          WHERE p.num_id = cc.num_id AND p.estado = 'pagada' AND p.id <> cc.id) h ON TRUE
      ORDER BY cc.creado_en DESC LIMIT 400`);
  return rows.map((r) => {
    let p: Propuesta | null = null;
    try { p = propuesta(r.tipo_persona, r.valor, r.itbis_facturado, r.creado_en.slice(0, 10)); }
    catch { p = null; }   // sin regla vigente: la tarjeta lo dice, no inventa un 0 %
    return { ...r, propuesta: p };
  });
}

/** Cuántos cobros de RD hay en un estado (el número del selector de país).
 *  Si la tabla todavía no existe (falta la §31 en esa base) devuelve undefined:
 *  el selector se pinta sin número en vez de tumbar la página de Colombia. */
export async function contarRD(estado: string): Promise<number | undefined> {
  try {
    const { rows } = await getPool().query<{ n: number }>(
      "SELECT count(*)::int AS n FROM rd_cuentas_cobro WHERE estado = $1", [estado]);
    return rows[0]?.n;
  } catch {
    return undefined;
  }
}

/** El host por el que se entró, para el enlace del formulario que va en el
 *  WhatsApp de "te la devolvimos": en pruebas apunta a pruebas, en producción a
 *  producción. Leerlo en el navegador haría que servidor y cliente pintaran
 *  enlaces distintos. */
export async function origenPeticion(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "www.manelfoods.co"}`;
}

/** El aviso cuando la tabla no existe en la base a la que se apunta. */
export const AYUDA_SIN_TABLA = "Si dice que rd_cuentas_cobro no existe, falta aplicar la sección 31 de db/schema.sql en esta base.";
