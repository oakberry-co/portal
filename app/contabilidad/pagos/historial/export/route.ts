// Exporta el historial de pagos a Excel (.xlsx). Una línea por factura pagada.
// Params opcionales: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&cuenta=Rappi
import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await getCurrentUser();

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
    `SELECT p.fecha_pago, p.nit_proveedor, f.nombre_proveedor, p.cuenta_pago,
            p.monto AS monto_pago, p.tipo, p.comprobante_url, p.nota, p.pagado_por,
            f.numero, pf.monto_aplicado
       FROM pagos p
       LEFT JOIN pago_facturas pf ON pf.pago_id = p.id
       LEFT JOIN facturas f ON f.cufe = pf.cufe
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
    { header: "Factura", key: "num", width: 14 },
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
  for (const r of rows) {
    ws.addRow({
      fecha: ymd(r.fecha_pago), nit: r.nit_proveedor, prov: r.nombre_proveedor ?? "",
      cuenta: r.cuenta_pago ?? "", num: r.numero ?? "", aplicado: n(r.monto_aplicado),
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
