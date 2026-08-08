import { getPool } from "@/lib/db";
import { PagosView, type FilaPago, type PagoHecho } from "./PagosView";

export const dynamic = "force-dynamic";

async function cargar(): Promise<{ pendientes: FilaPago[]; historial: PagoHecho[] }> {
  const pool = getPool();
  const pendientes = await pool.query<FilaPago>(`
    SELECT f.cufe, f.nombre_proveedor, f.nit_proveedor, f.numero, f.fecha_emision::text AS fecha_emision,
           e.concepto, e.destino,
           coalesce(e.fecha_pago_prog, e.fecha_vencimiento, f.fecha_emision)::text AS semana_fecha,
           coalesce(e.valor_a_pagar, f.total)::float AS a_pagar,
           coalesce(e.pago_monto,0)::float AS pagado,
           coalesce(e.pago_estado,'pendiente') AS pago_estado
    FROM factura_estado e JOIN facturas f USING (cufe)
    WHERE e.estado = 'retenciones_ok' AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
    ORDER BY semana_fecha, f.nombre_proveedor, f.fecha_emision
  `);
  const historial = await pool.query<PagoHecho>(`
    SELECT p.id, p.nit_proveedor, max(f.nombre_proveedor) AS proveedor,
           p.fecha_pago::text AS fecha_pago, p.monto::float AS monto, p.tipo,
           p.comprobante_url, p.nota, p.pagado_por, p.creado_en::text AS creado_en,
           count(pf.cufe)::int AS n_facturas,
           coalesce(json_agg(json_build_object('numero', f.numero, 'monto', pf.monto_aplicado)
             ORDER BY f.fecha_emision) FILTER (WHERE pf.cufe IS NOT NULL), '[]') AS facturas
    FROM pagos p
    LEFT JOIN pago_facturas pf ON pf.pago_id = p.id
    LEFT JOIN facturas f ON f.cufe = pf.cufe
    GROUP BY p.id
    ORDER BY p.fecha_pago DESC, p.id DESC
    LIMIT 300
  `);
  return { pendientes: pendientes.rows, historial: historial.rows };
}

export default async function PagosPage() {
  let data: { pendientes: FilaPago[]; historial: PagoHecho[] };
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>💸 Pagos</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  return (
    <div className="container">
      <h1>💸 Pagos</h1>
      <p className="sub">Centro de mando: <b>qué debo pagar</b> (por semana y proveedor) y <b>qué ya pagué</b>. Marca pagos o abonos, sube el soporte, o reprograma.</p>
      <PagosView pendientes={data.pendientes} historial={data.historial} />
    </div>
  );
}
