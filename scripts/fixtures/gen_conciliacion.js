#!/usr/bin/env node
/* eslint-disable */
// Genera el fixture del Excel de Conciliación para las pruebas.
//
// Los encabezados tienen que ser LOS MISMOS que produce
// app/(portal)/contabilidad/conciliacion/export/route.ts — de eso depende que la
// prueba valga algo. Los datos son inventados a propósito: el archivo real trae
// NIT y nombres de proveedores de verdad y eso no se versiona.
//
//   node scripts/fixtures/gen_conciliacion.js
const ExcelJS = require("exceljs");
const path = require("path");

const CABECERAS = ["Fecha emisión", "NIT", "Proveedor", "Factura", "Resp. DIAN",
  "Subtotal", "IVA", "Total", "Estado", "Concepto", "Destino", "Plazo (días)",
  "Vencimiento", "ReteFuente", "ReteIVA", "ReteICA", "Otros", "Otros concepto",
  "Observaciones", "Total retención", "Valor a pagar", "CUFE"];

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Conciliación");
  ws.addRow(CABECERAS);
  for (let i = 1; i <= 8; i++) {
    ws.addRow(["2026-08-0" + i, "900000" + String(i).padStart(3, "0"),
      `PROVEEDOR DE PRUEBA ${i} SAS`, `FP-${1000 + i}`, "O-48",
      3_000_000, 570_000, 3_570_000, "Clasificada", "Toppings", "BODBOG", 30,
      "2026-09-0" + i, null, null, null, null, "", "", null, null,
      "PRUEBA" + String(i).padStart(2, "0") + "a".repeat(88)]);
  }
  const salida = path.join(__dirname, "conciliacion.xlsx");
  await wb.xlsx.writeFile(salida);
  console.log("fixture generado:", salida);
})();
