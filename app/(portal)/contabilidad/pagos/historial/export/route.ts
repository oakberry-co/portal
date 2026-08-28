// Exporta el historial de pagos a Excel (.xlsx). Una línea por factura pagada —
// y una línea por solicitud del intake (cuenta de cobro / adelanto de
// cotización), que se paga igual pero no tiene factura electrónica: se
// identifica por su referencia (CC-12, COT-0004) y la columna Origen. Dejarlas
// fuera haría que el consolidado no cuadre con lo que salió del banco.
// Params opcionales: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&cuenta=Rappi
import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { etiquetaOrigen } from "@/lib/origen-pago";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await exigirCap("export_historial");  // admin + contador (causador)

  const url = new URL(req.url);
  const desde = url.searchParams.get("desde") || null;
  const hasta = url.searchParams.get("hasta") || null;
  const cuenta = url.searchParams.get("cuenta") || null;

  const params: string[] = [];
  const conds: string[] = [];
  if (desde) { params.push(desde); conds.push(`p.fecha_pago >= $${params.length}`); }
  if (hasta) { params.push(hasta); conds.push(`p.fecha_pago <= $${params.length}`); }
  if (cuenta) { params.push(cuenta); conds.push(`p.cuenta_pago = $${params.length}`); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  const { rows } = await getPool().query(
    `SELECT p.fecha_pago, p.nit_proveedor,
            coalesce(f.nombre_proveedor, ik.razon_social, mp.nombre) AS nombre_proveedor, p.cuenta_pago,
            ik.doc_tipo,
            p.monto AS monto_pago, p.tipo, p.comprobante_url, p.nota, p.pagado_por,
            p.origen, coalesce(f.numero, p.origen_ref) AS numero,
            coalesce(pf.monto_aplicado, CASE WHEN p.origen <> 'factura' THEN p.monto END) AS monto_aplicado
       FROM pagos p
       LEFT JOIN pago_facturas pf ON pf.pago_id = p.id
       LEFT JOIN facturas f ON f.cufe = pf.cufe
       LEFT JOIN maestro_proveedores mp ON mp.nit = p.nit_proveedor
       LEFT JOIN LATERAL (
         SELECT razon_social, tipo AS doc_tipo FROM cuentas_cobro WHERE pago_id = p.id
          UNION ALL
         SELECT razon_social, 'cotizacion' FROM cotizaciones  WHERE pago_id = p.id
          LIMIT 1) ik ON TRUE
       ${where}
      ORDER BY p.fecha_pago DESC, p.id DESC, f.fecha_emision`,
    params);

  const money = { numFmt: "#,##0" };
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Oakberry";
  const ws = wb.addWorksheet("Pagos");
  ws.columns = [
    { header: "Fecha pago", key: "fecha", width: 13 },
    { header: "NIT", key: "nit", width: 14 },
    { header: "Proveedor", key: "prov", width: 28 },
    { header: "Cuenta", key: "cuenta", width: 14 },
    { header: "Factura / ref.", key: "num", width: 16 },
    { header: "Origen", key: "origen", width: 18 },
    { header: "Monto aplicado", key: "aplicado", width: 15, style: money },
    { header: "Tipo", key: "tipo", width: 10 },
    { header: "Monto del pago", key: "montop", width: 15, style: money },
    { header: "Comprobante", key: "comp", width: 30 },
    { header: "Nota", key: "nota", width: 24 },
    { header: "Pagado por", key: "quien", width: 22 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F1E4" } };

  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const ymd = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");
  // La etiqueta la escribe el mismo módulo que la pantalla: el consolidado y el
  // tablero tienen que llamar igual al mismo gasto. Y distingue el servicio
  // público de la cuenta de cobro — entran por el mismo carril, pero llamarlos
  // a todos "cuenta de cobro" esconde el gasto que más se repite.
  for (const r of rows) {
    ws.addRow({
      fecha: ymd(r.fecha_pago), nit: r.nit_proveedor, prov: r.nombre_proveedor ?? "",
      cuenta: r.cuenta_pago ?? "", num: r.numero ?? "",
      origen: etiquetaOrigen(r.origen as string, r.doc_tipo as string | null), aplicado: n(r.monto_aplicado),
      tipo: r.tipo, montop: n(r.monto_pago), comp: r.comprobante_url ?? "",
      nota: r.nota ?? "", quien: r.pagado_por,
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const rango = `${desde ?? "inicio"}_a_${hasta ?? "fin"}`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pagos_${rango}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
