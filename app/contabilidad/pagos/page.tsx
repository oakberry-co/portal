import { getPool } from "@/lib/db";
import { PagosView, type FilaPago, type PagoHecho, type CuentaPago } from "./PagosView";

export const dynamic = "force-dynamic";

const CAMPOS = `
  f.cufe, f.nombre_proveedor, f.nit_proveedor, f.numero, f.fecha_emision::text AS fecha_emision,
  e.concepto, e.destino, e.cuenta_pago,
  coalesce(e.fecha_pago_prog, e.fecha_vencimiento, f.fecha_emision)::text AS semana_fecha,
  coalesce(e.valor_a_pagar, f.total)::float AS a_pagar,
  coalesce(e.pago_monto,0)::float AS pagado,
  coalesce(e.pago_estado,'pendiente') AS pago_estado,
  (cb.nit IS NOT NULL) AS tiene_banco`;

async function cargar(): Promise<{ pendientes: FilaPago[]; validacion: FilaPago[]; historial: PagoHecho[]; cuentas: CuentaPago[] }> {
  const pool = getPool();
  // Columna 1 — PENDIENTES: listas para pago (retenciones_ok), sin cuenta asignada.
  const pendientes = await pool.query<FilaPago>(`
    SELECT ${CAMPOS}
    FROM factura_estado e JOIN facturas f USING (cufe)
    LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = f.nit_proveedor
    WHERE e.estado = 'retenciones_ok' AND coalesce(e.pago_estado,'pendiente') <> 'pagado' AND e.cuenta_pago IS NULL
    ORDER BY semana_fecha, f.nombre_proveedor, f.fecha_emision`);
  // Columna 2 — VALIDACIÓN: cuenta asignada (aprobada_pago), aún no pagadas.
  const validacion = await pool.query<FilaPago>(`
    SELECT ${CAMPOS}
    FROM factura_estado e JOIN facturas f USING (cufe)
    LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = f.nit_proveedor
    WHERE e.estado = 'aprobada_pago' AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
    ORDER BY e.cuenta_pago, f.nombre_proveedor, f.fecha_emision`);
  // Columna 3 — CONFIRMADOS: los pagos ya registrados (con su cuenta).
  const historial = await pool.query<PagoHecho>(`
    SELECT p.id, p.nit_proveedor, max(f.nombre_proveedor) AS proveedor, p.cuenta_pago,
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
    LIMIT 300`);
  const cuentas = await pool.query<CuentaPago>("SELECT nombre, formato FROM cuentas_pago WHERE activo ORDER BY id");
  return { pendientes: pendientes.rows, validacion: validacion.rows, historial: historial.rows, cuentas: cuentas.rows };
}

export default async function PagosPage() {
  let data: Awaited<ReturnType<typeof cargar>>;
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>💸 Pagos</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  return (
    <div className="container container-wide">
      <h1>💸 Pagos</h1>
      <p className="sub">
        Tablero de pago: <b>Pendientes</b> (asigna la cuenta por factura) →
        <b> Validación semana en curso</b> (baja el archivo del banco por cuenta) →
        <b> Confirmados</b> (el banco ya pagó).
      </p>
      <PagosView pendientes={data.pendientes} validacion={data.validacion} historial={data.historial} cuentas={data.cuentas} />
    </div>
  );
}
