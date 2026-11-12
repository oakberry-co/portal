import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { concepto as conceptoDe, refRD, mesLegible } from "@/lib/rd/catalogo";
import { empresaRD } from "@/lib/rd/empresa";

export const dynamic = "force-dynamic";

// EL EXCEL PARA EL CONTADOR DE RD: dos hojas.
//
//  1. «606 borrador»: las compras del mes con las columnas del formato 606 de
//     la DGII, en su orden. Es un BORRADOR a propósito: lo revisa y lo sube el
//     contador con la herramienta de la DGII. Lo que el portal no sabe, no lo
//     inventa — lo marca en «Observación» (falta el B11, viene en dólares y hay
//     que pasarlo a pesos con la tasa del día del pago, es un pasaporte y el 606
//     solo acepta RNC o cédula).
//     «Fecha comprobante» = la de la factura del proveedor (si trajo NCF) o el
//     día del pago (si la empresa emite el B11, que se emite al pagar).
//  2. «Por pagar»: lo aprobado que todavía no sale del banco, con la cuenta
//     como TEXTO (los ceros a la izquierda son parte de la cuenta; Excel se los
//     come si es número — la trampa del archivo de Davivienda).

type Fila = {
  id: number; tipo_persona: string; nombre: string; tipo_id: string; num_id: string;
  concepto: string; concepto_otro: string | null; moneda: string; valor: number; itbis_facturado: number;
  ncf_proveedor: string | null; fecha_ncf: string | null; ncf_emitido: string | null;
  isr_retenido: number | null; itbis_retenido: number | null; valor_a_pagar: number | null;
  banco: string; tipo_cuenta: string; num_cuenta: string; titular_cuenta: string;
  estado: string; aprobado_en: string | null; pagado_en: string | null; referencia_pago: string | null;
};

const aaaammdd = (d: string | null) => (d ? d.slice(0, 10).replace(/-/g, "") : "");

export async function GET(req: Request) {
  await exigirCap("rd");
  const mes = new URL(req.url).searchParams.get("mes") ?? "";
  if (!/^\d{4}-\d{2}$/.test(mes)) return new Response("Falta ?mes=AAAA-MM", { status: 400 });

  const { rows } = await getPool().query<Fila>(
    `SELECT id, tipo_persona, nombre, tipo_id, num_id, concepto, concepto_otro, moneda,
            valor::float AS valor, itbis_facturado::float AS itbis_facturado,
            ncf_proveedor, fecha_ncf::text AS fecha_ncf, ncf_emitido,
            isr_retenido::float AS isr_retenido, itbis_retenido::float AS itbis_retenido,
            valor_a_pagar::float AS valor_a_pagar, banco, tipo_cuenta, num_cuenta, titular_cuenta,
            estado, aprobado_en::text AS aprobado_en, pagado_en::text AS pagado_en, referencia_pago
       FROM rd_cuentas_cobro
      WHERE estado IN ('aprobada','pagada')
      ORDER BY id`);

  const enMes = (d: string | null) => !!d && d.slice(0, 7) === mes;
  // Una compra entra al 606 del mes de su COMPROBANTE. Con NCF propio, su fecha;
  // con B11, el pago (el B11 se emite al pagar: sin pago todavía no hay
  // comprobante que reportar).
  const del606 = rows.filter((r) => (r.ncf_proveedor ? enMes(r.fecha_ncf) : r.estado === "pagada" && enMes(r.pagado_en)));
  const porPagar = rows.filter((r) => r.estado === "aprobada");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Oakberry";
  const money = { numFmt: "#,##0.00" };
  const texto = { numFmt: "@" };
  const empresa = empresaRD();

  const ws = wb.addWorksheet("606 borrador");
  ws.addRow([`BORRADOR del formato 606 · ${mesLegible(mes)} · ${empresa.nombre}${empresa.rnc ? " · RNC " + empresa.rnc : " · RNC SIN CONFIGURAR"} — lo revisa el contador antes de enviarlo a la DGII`]);
  ws.getRow(1).font = { bold: true, color: { argb: "FF4B1F60" } };
  const cab = ["RNC o Cédula", "Tipo Id", "Tipo Bienes y Servicios Comprados", "NCF", "NCF o Documento Modificado",
    "Fecha Comprobante", "Fecha Pago", "Monto Facturado en Servicios", "Monto Facturado en Bienes", "Total Monto Facturado",
    "ITBIS Facturado", "ITBIS Retenido", "ITBIS sujeto a Proporcionalidad", "ITBIS llevado al Costo", "ITBIS por Adelantar",
    "ITBIS percibido en compras", "Tipo de Retención en ISR", "Monto Retención Renta", "ISR Percibido en compras",
    "Impuesto Selectivo al Consumo", "Otros Impuestos/Tasas", "Monto Propina Legal", "Forma de Pago",
    "Referencia", "Nombre", "Moneda", "Observación"];
  ws.addRow(cab).font = { bold: true };
  for (const r of del606) {
    const c = conceptoDe(r.concepto);
    const obs: string[] = [];
    if (r.tipo_id === "pasaporte") obs.push("Pasaporte: el 606 solo acepta RNC o cédula — consultar al contador");
    if (r.moneda === "USD") obs.push("En US$: convertir a RD$ con la tasa del día del pago");
    const ncf = r.ncf_proveedor ?? r.ncf_emitido;
    if (!ncf) obs.push("FALTA el B11 que emite la empresa");
    if (r.estado !== "pagada") obs.push("Aprobada, todavía sin pago");
    const fila = ws.addRow([
      r.num_id, r.tipo_id === "rnc" ? "1" : r.tipo_id === "cedula" ? "2" : "",
      c?.tipo606 ?? "02", ncf ?? "", "",
      aaaammdd(r.ncf_proveedor ? r.fecha_ncf : r.pagado_en), aaaammdd(r.pagado_en),
      r.valor, 0, r.valor,
      r.itbis_facturado, r.itbis_retenido ?? 0, 0, 0, r.itbis_facturado,
      0, (r.isr_retenido ?? 0) > 0 ? (c?.isr606 ?? "2") : "", r.isr_retenido ?? 0, 0,
      0, 0, 0, r.estado === "pagada" ? "02" : "",
      refRD(r.id), r.nombre, r.moneda, obs.join(" · "),
    ]);
    // Identificación, NCF, fechas y códigos como TEXTO: '001…' no es '1…', y un
    // código '02' no es el número 2.
    for (const k of [1, 2, 3, 4, 6, 7, 17, 23]) fila.getCell(k).numFmt = texto.numFmt;
    for (const k of [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22]) fila.getCell(k).numFmt = money.numFmt;
    if (obs.length) fila.getCell(27).font = { color: { argb: "FFA33A1B" }, bold: true };
  }
  if (!del606.length) ws.addRow(["(sin compras con comprobante en este mes)"]);
  ws.columns.forEach((col, i) => { col.width = i === 24 ? 30 : i === 26 ? 60 : 16; });

  const wp = wb.addWorksheet("Por pagar");
  wp.columns = [
    { header: "Referencia", key: "ref", width: 11 },
    { header: "Nombre", key: "nombre", width: 30 },
    { header: "Identificación", key: "id", width: 14, style: texto },
    { header: "Banco", key: "banco", width: 26 },
    { header: "Tipo de cuenta", key: "tipo", width: 12 },
    { header: "Número de cuenta", key: "cuenta", width: 20, style: texto },
    { header: "Titular", key: "titular", width: 28 },
    { header: "Moneda", key: "moneda", width: 8 },
    { header: "Valor", key: "valor", width: 14, style: money },
    { header: "ITBIS", key: "itbis", width: 12, style: money },
    { header: "ISR retenido", key: "isr", width: 13, style: money },
    { header: "ITBIS retenido", key: "itbisr", width: 13, style: money },
    { header: "NETO A TRANSFERIR", key: "neto", width: 18, style: money },
    { header: "Aprobada", key: "aprob", width: 12 },
  ];
  wp.getRow(1).font = { bold: true };
  for (const r of porPagar) {
    wp.addRow({ ref: refRD(r.id), nombre: r.nombre, id: r.num_id, banco: r.banco, tipo: r.tipo_cuenta,
                cuenta: r.num_cuenta, titular: r.titular_cuenta, moneda: r.moneda, valor: r.valor,
                itbis: r.itbis_facturado, isr: r.isr_retenido ?? 0, itbisr: r.itbis_retenido ?? 0,
                neto: r.valor_a_pagar, aprob: (r.aprobado_en ?? "").slice(0, 10) });
  }
  // Totales POR MONEDA: DOP y USD no se suman nunca.
  for (const m of ["DOP", "USD"]) {
    const t = porPagar.filter((r) => r.moneda === m).reduce((a, r) => a + (r.valor_a_pagar ?? 0), 0);
    if (t) { const f = wp.addRow({ nombre: `TOTAL ${m}`, moneda: m, neto: t }); f.font = { bold: true }; }
  }

  const buf = await wb.xlsx.writeBuffer();
  const pruebas = process.env.AMBIENTE === "pruebas" ? "PRUEBAS-NO-USAR_" : "";
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${pruebas}rd_cuentas_cobro_${mes}.xlsx"`,
    },
  });
}
