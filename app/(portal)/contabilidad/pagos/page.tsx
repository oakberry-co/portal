import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { LISTO_PARA_PAGOS } from "@/lib/documentos-no-dian";
import { PagosView, type FilaPago, type FilaIntake, type PagoHecho, type CuentaPago, type Adelanto } from "./PagosView";

export const dynamic = "force-dynamic";

const CAMPOS = `
  f.cufe, f.nombre_proveedor, f.nit_proveedor, f.numero, f.fecha_emision::text AS fecha_emision,
  e.concepto, e.destino, e.cuenta_pago,
  e.fecha_vencimiento::text AS fecha_vencimiento,
  coalesce(e.fecha_pago_prog, e.fecha_vencimiento, f.fecha_emision)::text AS semana_fecha,
  coalesce(e.valor_a_pagar, f.total)::float AS a_pagar,
  coalesce(e.pago_monto,0)::float AS pagado,
  coalesce(e.abono_aplicado,0)::float AS abono_aplicado,
  coalesce(e.pago_estado,'pendiente') AS pago_estado,
  (cb.nit IS NOT NULL) AS tiene_banco`;

// Lo aprobado en las dos bandejas del intake: cuentas de cobro (por su valor
// NETO de retenciones) y adelantos de cotización (por el % pactado). Van al bloque "sin
// factura DIAN" de Validación — plata real, sin factura electrónica detrás.
const SQL_INTAKE = `
  SELECT 'cuenta_cobro' AS tipo, cc.id, 'CC-' || cc.id AS ref,
         cc.razon_social AS proveedor, cc.num_doc AS nit, cc.concepto, cc.area,
         -- LO QUE SE PAGA es el neto de retenciones, no el valor del cobro.
         coalesce(cc.valor_a_pagar, cc.valor, 0)::float AS monto, cc.cuenta_pago,
         cc.fecha_pago_prog::text AS fecha_pago_prog, cc.creado_en::text AS creado_en,
         NULL::float AS pct, coalesce(cc.valor,0)::float AS base,
         (cb.num_cuenta IS NOT NULL) AS tiene_banco, cb.banco, cb.certificada
    FROM cuentas_cobro cc
    LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = cc.num_doc
   -- Aprobada ya NO alcanza: entra a Pagos cuando está CLASIFICADA (concepto,
   -- destino y retenciones), igual que una factura. Mientras tanto vive en
   -- Conciliación. La condición es una sola en todo el sistema — si se copia,
   -- una copia envejece y el candado deja de existir por un lado.
   WHERE ${LISTO_PARA_PAGOS("cc")}
  UNION ALL
  SELECT 'cotizacion', cot.id, coalesce(cot.codigo, 'COT-' || cot.id),
         cot.razon_social, cot.nit, cot.concepto, cot.area,
         round(coalesce(cot.valor,0) * coalesce(cot.adelanto_pct,0) / 100)::float,
         cot.cuenta_pago, cot.fecha_pago_prog::text, cot.creado_en::text,
         cot.adelanto_pct::float, cot.valor::float,
         (cb.num_cuenta IS NOT NULL), cb.banco, cb.certificada
    FROM cotizaciones cot
    LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = cot.nit
   WHERE cot.estado IN ('aprobada','facturada') AND cot.pago_id IS NULL
     AND cot.requiere_adelanto
  ORDER BY fecha_pago_prog NULLS FIRST, proveedor`;

async function cargar(): Promise<{ pendientes: FilaPago[]; validacion: FilaPago[]; intake: FilaIntake[]; historial: PagoHecho[]; cuentas: CuentaPago[]; diaPago: number; adelantos: Adelanto[] }> {
  const pool = getPool();
  // Columna 1 — PENDIENTES: listas para pago (retenciones_ok), sin cuenta asignada.
  const pendientes = await pool.query<FilaPago>(`
    SELECT ${CAMPOS}
    FROM factura_estado e JOIN facturas f USING (cufe)
    LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = f.nit_proveedor
    LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
    WHERE e.estado = 'retenciones_ok' AND coalesce(e.pago_estado,'pendiente') <> 'pagado' AND e.cuenta_pago IS NULL
      AND coalesce(e.tipo_pago, mp.tipo_pago_default, 'credito') <> 'debito'
    ORDER BY semana_fecha, f.nombre_proveedor, f.fecha_emision`);
  // Columna 2 — VALIDACIÓN: cuenta asignada (aprobada_pago), aún no pagadas.
  const validacion = await pool.query<FilaPago>(`
    SELECT ${CAMPOS}
    FROM factura_estado e JOIN facturas f USING (cufe)
    LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = f.nit_proveedor
    WHERE e.estado = 'aprobada_pago' AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
    ORDER BY e.cuenta_pago, f.nombre_proveedor, f.fecha_emision`);
  // Adelantos YA PAGADOS que todavía no se descontaron de ninguna factura. Es
  // plata que ya salió: si no se ve acá, la factura del proveedor se paga
  // completa y el anticipo termina pagándose dos veces.
  const adelantos = await pool.query<Adelanto>(`
    SELECT cot.id, coalesce(cot.codigo, 'COT-' || cot.id) AS codigo, cot.nit,
           cot.razon_social, cot.valor::float AS valor,
           coalesce((SELECT sum(monto) FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id),0)::float AS abonado
      FROM cotizaciones cot
     WHERE cot.cufe_factura IS NULL
       AND EXISTS (SELECT 1 FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id)
     ORDER BY cot.creado_en`);
  // Bloque APARTE de Validación — lo aprobado en el intake (sin factura DIAN).
  const intake = await pool.query<FilaIntake>(SQL_INTAKE);
  // Columna 4 — CONFIRMADOS: los pagos ya registrados (con su cuenta).
  // `origen` distingue el pago de una factura del de una cuenta de cobro o un
  // adelanto: sin él, un pago sin facturas parecería un registro roto.
  const historial = await pool.query<PagoHecho>(`
    SELECT p.id, p.nit_proveedor,
           coalesce(max(f.nombre_proveedor), max(p.origen_ref)) AS proveedor, p.cuenta_pago,
           p.fecha_pago::text AS fecha_pago, p.monto::float AS monto, p.tipo,
           p.origen, p.origen_ref,
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
  const cuentas = await pool.query<CuentaPago>("SELECT nombre, formato, activo FROM cuentas_pago ORDER BY id");
  const cfg = await pool.query<{ valor: string }>("SELECT valor FROM config_pagos WHERE clave = 'dia_pago'");
  const diaPago = Number(cfg.rows[0]?.valor ?? 5) || 5;
  return { pendientes: pendientes.rows, validacion: validacion.rows, intake: intake.rows,
           historial: historial.rows, cuentas: cuentas.rows, diaPago, adelantos: adelantos.rows };
}

export default async function PagosPage() {
  let data: Awaited<ReturnType<typeof cargar>>;
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>💸 Pagos</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  const { rol } = await getCurrentUser();
  const puedePagos = puede(rol, "pagos");  // contador (causador) = false → solo Historial
  return (
    <div className="container container-wide">
      <h1>💸 Pagos</h1>
      <p className="sub">
        {puedePagos ? (
          <>Tablero de pago: <b>Pendientes</b> (asigna la cuenta por factura) →
          <b> Validación semana en curso</b> (baja el archivo del banco por cuenta) →
          <b> Confirmados</b> (el banco ya pagó).</>
        ) : (
          <>Consolidado de pagos: consulta el <b>Historial</b> y descárgalo en Excel.</>
        )}
      </p>
      <PagosView pendientes={data.pendientes} validacion={data.validacion} intake={data.intake} adelantos={data.adelantos} historial={data.historial} cuentas={data.cuentas} diaPago={data.diaPago} puedePagos={puedePagos} />
    </div>
  );
}
