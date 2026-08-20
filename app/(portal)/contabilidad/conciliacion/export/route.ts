// Exporta el informe de conciliación a Excel (.xlsx) por rango de fechas.
// Ruta protegida por el middleware (solo sesión válida). Params: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { ETIQUETA, type Estado } from "@/lib/estados";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await exigirCap("clasificar"); // solo quien opera conciliación (admin); el contador NO

  const url = new URL(req.url);
  const desde = url.searchParams.get("desde") || null;
  const hasta = url.searchParams.get("hasta") || null;

  const params: string[] = [];
  const conds: string[] = [];
  if (desde) { params.push(desde); conds.push(`f.fecha_emision >= $${params.length}`); }
  if (hasta) { params.push(hasta); conds.push(`f.fecha_emision <= $${params.length}`); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  const { rows } = await getPool().query(
    `SELECT f.fecha_emision, f.nit_proveedor, f.nombre_proveedor, f.numero, f.responsabilidad_dian,
            f.subtotal, f.iva, f.total,
            e.estado, e.concepto, e.destino, e.plazo_dias, e.fecha_vencimiento,
            e.retefuente, e.reteiva, e.reteica, e.reten_total, e.valor_a_pagar,
            e.otros_valor, e.otros_concepto, e.observaciones, f.cufe
       FROM facturas f JOIN factura_estado e USING (cufe)
       ${where}
      ORDER BY f.fecha_emision, f.nombre_proveedor`,
    params
  );

  const money = { numFmt: "#,##0" };
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Oakberry";
  const ws = wb.addWorksheet("Conciliación");
  ws.columns = [
    { header: "Fecha emisión", key: "fecha", width: 13 },
    { header: "NIT", key: "nit", width: 14 },
    { header: "Proveedor", key: "prov", width: 28 },
    { header: "Factura", key: "num", width: 14 },
    { header: "Resp. DIAN", key: "resp", width: 11 },
    { header: "Subtotal", key: "subtotal", width: 14, style: money },
    { header: "IVA", key: "iva", width: 12, style: money },
    { header: "Total", key: "total", width: 14, style: money },
    { header: "Estado", key: "estado", width: 16 },
    { header: "Concepto", key: "concepto", width: 18 },
    { header: "Destino", key: "destino", width: 20 },
    { header: "Plazo (días)", key: "plazo", width: 11 },
    { header: "Vencimiento", key: "venc", width: 13 },
    { header: "ReteFuente", key: "rf", width: 12, style: money },
    { header: "ReteIVA", key: "ri", width: 12, style: money },
    { header: "ReteICA", key: "ric", width: 12, style: money },
    { header: "Otros", key: "otros", width: 12, style: money },
    { header: "Otros concepto", key: "otrosc", width: 20 },
    { header: "Observaciones", key: "obs", width: 26 },
    { header: "Total retención", key: "ret", width: 14, style: money },
    { header: "Valor a pagar", key: "pagar", width: 15, style: money },
    { header: "CUFE", key: "cufe", width: 42 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F1E4" } };

  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const ymd = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");
  for (const r of rows) {
    ws.addRow({
      fecha: ymd(r.fecha_emision),
      nit: r.nit_proveedor,
      prov: r.nombre_proveedor ?? "",
      num: r.numero,
      resp: r.responsabilidad_dian ?? "",
      subtotal: n(r.subtotal), iva: n(r.iva), total: n(r.total),
      estado: ETIQUETA[r.estado as Estado] ?? r.estado,
      concepto: r.concepto ?? "", destino: r.destino ?? "",
      plazo: r.plazo_dias ?? "",
      venc: ymd(r.fecha_vencimiento),
      rf: n(r.retefuente), ri: n(r.reteiva), ric: n(r.reteica),
      otros: n(r.otros_valor), otrosc: r.otros_concepto ?? "", obs: r.observaciones ?? "",
      ret: n(r.reten_total), pagar: n(r.valor_a_pagar),
      cufe: r.cufe,
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const rango = `${desde ?? "inicio"}_a_${hasta ?? "fin"}`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="conciliacion_${rango}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
