// Exporta el informe de conciliación a Excel (.xlsx) por rango de fechas.
// Ruta protegida por el middleware (solo sesión válida). Params: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import { refDe } from "@/lib/ref-documento";
import { exigirCap } from "@/lib/auth";
import { ETIQUETA, type Estado } from "@/lib/estados";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Quien CONFIRMA retenciones tiene que poder BAJAR el archivo que va a llenar:
  // ese es el trámite entero (bajar → escribir a mano → subir). Antes exigía
  // `clasificar`, que el contador externo no tiene, así que podía subir el Excel
  // pero no obtenerlo — un camino sin salida.
  await exigirCap("retenciones");

  const url = new URL(req.url);
  const desde = url.searchParams.get("desde") || null;
  const hasta = url.searchParams.get("hasta") || null;

  const params: string[] = [];
  const conds: string[] = [];
  if (desde) { params.push(desde); conds.push(`f.fecha_emision >= $${params.length}`); }
  if (hasta) { params.push(hasta); conds.push(`f.fecha_emision <= $${params.length}`); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  const pool = getPool();
  const { rows } = await pool.query(
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
    // La llave del viaje de vuelta. Las facturas traen su CUFE; lo que no tiene
    // factura DIAN trae su referencia (CC-46 / SP-51), que es su llave — lo que
    // sale tiene que poder volver (Regla 15). Se distinguen por la FORMA, no
    // adivinando: un CUFE son 96 hexadecimales.
    { header: "CUFE / Ref", key: "cufe", width: 42 },
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

  // LO QUE NO TIENE FACTURA DIAN VA EN EL MISMO ARCHIVO. Es el mismo trabajo
  // para el contador —les pone su retención, aunque sea cero— y es lo que
  // permite pagar todo en UNA sola tanda en vez de dejarlos por fuera y tener
  // que acordarse de ellos aparte.
  // Params propios: reusar los de la consulta de facturas por posición se rompe
  // el día que una de las dos fechas no venga.
  const pnd: string[] = [];
  const cnd: string[] = [];
  const fechaND = "coalesce(cc.fecha_documento, cc.creado_en::date)";
  if (desde) { pnd.push(desde); cnd.push(`${fechaND} >= $${pnd.length}`); }
  if (hasta) { pnd.push(hasta); cnd.push(`${fechaND} <= $${pnd.length}`); }
  const nd = await pool.query(
    `SELECT cc.id, cc.tipo, cc.fecha_documento, cc.creado_en, cc.num_doc, cc.razon_social,
            cc.numero, cc.valor, cc.iva_incluido, cc.estado, cc.pago_id,
            cc.concepto, cc.destino, cc.plazo_dias, cc.fecha_vencimiento,
            cc.retefuente, cc.reteiva, cc.reteica, cc.reten_total, cc.valor_a_pagar,
            cc.otros_valor, cc.otros_concepto, cc.observaciones
       FROM cuentas_cobro cc
      WHERE cc.estado IN ('aprobada','pagada')
        ${cnd.length ? "AND " + cnd.join(" AND ") : ""}
      ORDER BY ${fechaND}, cc.razon_social`,
    pnd);
  for (const r of nd.rows) {
    ws.addRow({
      fecha: ymd(r.fecha_documento ?? r.creado_en),
      nit: r.num_doc,
      prov: r.razon_social ?? "",
      num: "SIN FACTURA",
      resp: "",
      subtotal: null, iva: n(r.iva_incluido), total: n(r.valor),
      estado: r.pago_id ? "Pagada" : "Sin factura DIAN",
      concepto: r.concepto ?? "", destino: r.destino ?? "",
      plazo: r.plazo_dias ?? "",
      venc: ymd(r.fecha_vencimiento),
      rf: n(r.retefuente), ri: n(r.reteiva), ric: n(r.reteica),
      otros: n(r.otros_valor), otrosc: r.otros_concepto ?? "", obs: r.observaciones ?? "",
      ret: n(r.reten_total), pagar: n(r.valor_a_pagar),
      // La MISMA función que arma la referencia en la bandeja: una sola forma
      // de nombrar el documento, o el Excel diría CC-46 donde la pantalla dice SP-46.
      cufe: refDe(String(r.tipo), Number(r.id)),
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
