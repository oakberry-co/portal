import { getPool } from "@/lib/db";
import { ETIQUETA } from "@/lib/estados";
import { ConciliacionView } from "./ConciliacionView";
import { SyncPanel } from "./SyncPanel";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import type { FacturaRow } from "./FacturaCard";
import { DocsNoDian, type DocNoDianUI } from "./DocsNoDian";
import { porClasificar } from "@/lib/documentos-no-dian";

export const dynamic = "force-dynamic"; // siempre lee el estado vivo

type SyncStatus = { ultima: string | null; nuevas: number | null; pendiente: string | null };

function haceCuanto(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function hora(d: Date): string {
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });
}

async function cargar(): Promise<{ filas: FacturaRow[]; conceptos: string[]; destinos: string[]; sync: SyncStatus; docsNoDian: DocNoDianUI[] }> {
  const pool = getPool();
  const filas = await pool.query<FacturaRow>(
    `SELECT f.cufe, f.nombre_proveedor, f.nit_proveedor, f.numero, f.fecha_emision,
            f.subtotal, f.iva, f.total, f.responsabilidad_dian, f.link_drive, f.sincronizado_en,
            e.estado, e.concepto, e.destino, e.plazo_dias, e.fecha_vencimiento,
            e.retencion_ok, e.reten_total, e.retefuente, e.reteiva, e.reteica, e.valor_a_pagar,
            e.otros_valor, e.otros_concepto, e.observaciones,
            e.pago_estado, e.fecha_pago_prog,
            coalesce(e.abono_aplicado,0)::float AS abono_aplicado,
            cot.id AS cot_id, cot.codigo AS cot_codigo,
            COALESCE(p.concepto_sug, mp.concepto_default) AS concepto_sug,
            COALESCE(p.destino_sug, mp.destino_default) AS destino_sug,
            p.confianza, mp.plazo_dias AS plazo_sug,
            COALESCE(e.tipo_pago, mp.tipo_pago_default) AS tipo_pago,
            p.retefuente_sug, p.reteiva_sug, p.reteica_sug,
            -- ::float antes de ::text: un NUMERIC da '0.0000' y '2.5000', que en la
            -- casilla se leen mal. Así quedan '0' y '2.5'.
            mr.ret_rf::float::text AS ret_rf, mr.ret_ica::float::text AS ret_ica,
            mr.ret_iva::float::text AS ret_iva,
            rc.retefuente::text AS rc_rf, rc.reteica::text AS rc_ica,
            rc.aplica AS rc_aplica, rc.n_casos AS rc_n,
            rc.concordancia::text AS rc_conc, rc.fuente AS rc_fuente,
            vs.soporte_url, vs.n_soportes, vs.destino_drive,
            -- Desvío del pago de ESTA factura + la cuenta del maestro, para
            -- poder mostrar de dónde se está desviando.
            e.cta_dest_banco, e.cta_dest_tipo, e.cta_dest_numero, e.cta_dest_titular,
            e.cta_dest_doc, e.cta_dest_motivo, e.cta_dest_por,
            cb.banco AS cb_banco, cb.num_cuenta AS cb_num_cuenta
       FROM facturas f
       JOIN factura_estado e USING (cufe)
       LEFT JOIN factura_propuesta p USING (cufe)
       LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
       LEFT JOIN (
         SELECT nit_proveedor,
                max(CASE WHEN tipo='ReteFuente' THEN tarifa END) AS ret_rf,
                max(CASE WHEN tipo='ReteICA'    THEN tarifa END) AS ret_ica,
                max(CASE WHEN tipo='ReteIVA'    THEN tarifa END) AS ret_iva
         FROM maestro_retenciones GROUP BY nit_proveedor
       ) mr ON mr.nit_proveedor = f.nit_proveedor
       -- Lo que el equipo YA viene practicando para ESTE concepto
       -- (scripts/aprender_retenciones.py). No se aplica solo: precarga el modal
       -- diciendo en cuántos casos se basa, y decide un humano.
       LEFT JOIN regla_retencion_concepto rc ON rc.concepto = e.concepto
       LEFT JOIN v_factura_soportes vs USING (cufe)
       LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = f.nit_proveedor
       -- La cotización cuyo adelanto ya se aplicó a esta factura (el cruce).
       LEFT JOIN cotizaciones cot ON cot.cufe_factura = f.cufe
      ORDER BY (e.estado = 'capturada') DESC, f.fecha_emision DESC`
  );
  const c = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_conceptos WHERE activo ORDER BY nombre");
  const d = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_destinos WHERE activo ORDER BY nombre");

  // Estado del sync: último evento 'sync' + si hay una solicitud pendiente.
  const s = await pool.query<{ creado_en: Date; nuevas: number | null }>(
    "SELECT creado_en, (valor_nuevo->>'facturas_nuevas')::int AS nuevas FROM eventos WHERE tipo = 'sync' ORDER BY id DESC LIMIT 1"
  );
  const pend = await pool.query<{ solicitado_por: string; solicitado_en: Date }>(
    "SELECT solicitado_por, solicitado_en FROM sync_solicitudes WHERE estado = 'pendiente' ORDER BY id DESC LIMIT 1"
  );
  const sync: SyncStatus = {
    ultima: s.rows[0] ? haceCuanto(new Date(s.rows[0].creado_en)) : null,
    nuevas: s.rows[0]?.nuevas ?? null,
    pendiente: pend.rows[0]
      ? `Solicitada por ${pend.rows[0].solicitado_por.split("@")[0]} · ${hora(new Date(pend.rows[0].solicitado_en))}`
      : null,
  };

  // Los documentos SIN factura DIAN (cuentas de cobro aprobadas y gastos
  // internos) que están esperando concepto/destino/retenciones.
  const docsNoDian = (await porClasificar()) as unknown as DocNoDianUI[];

  return { filas: filas.rows, conceptos: c.rows.map((r) => r.nombre), destinos: d.rows.map((r) => r.nombre), sync, docsNoDian };
}

export default async function ConciliacionPage() {
  let data: Awaited<ReturnType<typeof cargar>>;
  try {
    data = await cargar();
  } catch (e) {
    // El deploy funciona; solo falta la base (o el esquema). Mensaje amable, no un 500.
    return (
      <div className="container">
        <h1>🧾 Conciliación de pagos</h1>
        <p className="sub">La app está desplegada ✅, pero falta conectar la base de datos.</p>
        <div className="card" style={{ maxWidth: 680 }}>
          <h3>Falta la base de datos</h3>
          <p>
            Conecta Neon en Vercel (Storage → Create Database → Neon) y aplica{" "}
            <code>db/schema.sql</code>. Luego esta pantalla se llena sola.
          </p>
          <p className="hint" style={{ marginTop: 10 }}>Detalle: {(e as Error).message}</p>
        </div>
      </div>
    );
  }

  const { filas, conceptos, destinos, sync, docsNoDian } = data;
  const { rol } = await getCurrentUser();
  const puedeClasificar = puede(rol, "clasificar");  // contador (causador) = false
  // El contador SÍ sube el Excel de retenciones: es justo su trabajo.
  const puedeRetenciones = puede(rol, "retenciones");

  return (
    <div className="container">
      <h1>🧾 Conciliación de pagos</h1>
      <SyncPanel ultima={sync.ultima} nuevas={sync.nuevas} pendiente={sync.pendiente} />
      {/* Va ARRIBA de la grilla a propósito: son pocos y son los que frenan un
          pago. Si quedaran al final de 4.000 facturas, nadie los vería. */}
      <DocsNoDian docs={docsNoDian} conceptos={conceptos} destinos={destinos} puedeClasificar={puedeClasificar} />
      <ConciliacionView filas={filas} conceptos={conceptos} destinos={destinos} puedeClasificar={puedeClasificar} puedeExport={puede(rol, "retenciones")} puedeRetenciones={puedeRetenciones} />

      <p className="chain-note">
        🔒 Cada guardado escribe el cambio <em>y</em> su evento en la misma transacción; la bitácora
        es append-only y encadenada por hash (imposible editar o borrar sin romper la cadena).
      </p>
      <p className="chain-note">Estados: {Object.values(ETIQUETA).join(" → ")}</p>
    </div>
  );
}
