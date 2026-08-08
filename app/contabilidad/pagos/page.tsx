import { getPool } from "@/lib/db";
import { PagosView, type FilaPago } from "./PagosView";

export const dynamic = "force-dynamic";

async function cargar(): Promise<FilaPago[]> {
  const { rows } = await getPool().query<FilaPago>(`
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
  return rows;
}

export default async function PagosPage() {
  let filas: FilaPago[];
  try {
    filas = await cargar();
  } catch (e) {
    return <div className="container"><h1>💸 Pagos</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  return (
    <div className="container">
      <h1>💸 Pagos</h1>
      <p className="sub">Lo que ya está <b>clasificado y con retenciones</b>, agrupado por <b>semana</b> y <b>proveedor</b>. Marca lo que se paga (o abona), sube el soporte, o pásalo a otra semana.</p>
      <PagosView filas={filas} />
    </div>
  );
}
