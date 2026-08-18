import { getPool } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { sqlCertificacion } from "@/lib/certificaciones";
import { CotizacionesView, type Cotizacion, type CandidataFactura } from "./CotizacionesView";

export const dynamic = "force-dynamic";

// Igual que en cuentas de cobro: la bandeja carga lo que decide la aprobación
// (documentos + certificación + cuenta del maestro) para explicar el bloqueo en
// la tarjeta, no al hacer clic.
async function cargar(): Promise<{ cots: Cotizacion[]; candidatos: CandidataFactura[] }> {
  const pool = getPool();
  const cots = await pool.query<Cotizacion>(`
    SELECT cot.id, cot.codigo, cot.razon_social, cot.nit, cot.contacto, cot.correo, cot.telefono,
           cot.area, cot.concepto, cot.descripcion, cot.valor::float AS valor, cot.documentos,
           cot.numero_cotizacion, cot.requiere_adelanto, cot.adelanto_pct::float AS adelanto_pct,
           cot.plazo_dias, cot.estado, cot.cufe_factura, cot.nota_revision, cot.revisado_por,
           cot.creado_en::text AS creado_en, cot.cuenta_pago, cot.pago_id,
           to_jsonb(cert) AS cert, to_jsonb(cb) AS cuenta,
           coalesce((SELECT sum(monto) FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id),0)::float AS abono_total,
           coalesce((SELECT json_agg(json_build_object('monto', monto, 'fecha', fecha::text, 'cuenta', cuenta_pago) ORDER BY fecha)
                     FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id), '[]') AS abonos,
           f.numero AS fact_numero, f.total::float AS fact_total
      FROM cotizaciones cot
      LEFT JOIN facturas f ON f.cufe = cot.cufe_factura
      ${sqlCertificacion("cotizacion", "cot.id")}
      LEFT JOIN LATERAL (
        SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
          FROM cuentas_bancarias_proveedor y WHERE y.nit = cot.nit) cb ON TRUE
     ORDER BY cot.creado_en DESC LIMIT 500`);
  const cand = await pool.query<CandidataFactura>(`
    SELECT f.cufe, f.numero, f.nit_proveedor AS nit, f.total::float AS total
      FROM facturas f
     WHERE f.nit_proveedor IN (SELECT DISTINCT nit FROM cotizaciones WHERE estado IN ('recibida','aprobada'))
       AND NOT EXISTS (SELECT 1 FROM cotizaciones c2 WHERE c2.cufe_factura = f.cufe)
     ORDER BY f.fecha_emision DESC LIMIT 800`);
  return { cots: cots.rows, candidatos: cand.rows };
}

export default async function CotizacionesInboxPage() {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "intake")) redirect("/contabilidad/conciliacion");
  let data: Awaited<ReturnType<typeof cargar>>;
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>📄 Cotizaciones</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  return (
    <div className="container">
      <h1>📄 Cotizaciones</h1>
      <p className="sub">
        Del formulario público <b>manelfoods.co/cotizaciones</b>. Al aprobar, el <b>adelanto</b> pasa a
        <b> Pagos › Validación semana en curso</b> (bloque <i>sin factura DIAN</i>); cuando llegue la factura final,
        <b> enlázala</b> y Pagos le descuenta lo adelantado (nunca doble).
      </p>
      <CotizacionesView cots={data.cots} candidatos={data.candidatos} />
    </div>
  );
}
